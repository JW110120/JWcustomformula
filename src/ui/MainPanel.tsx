import React, { useEffect, useMemo, useRef, useState } from 'react';
// 使用 Spectrum Web Components（sp-*），不再依赖 React Spectrum 组件。
// 为了在 TSX 中直接使用自定义元素，这里声明 IntrinsicElements。
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'sp-action-button': any;
      'sp-picker': any;
      'sp-menu-item': any;
      'sp-tabs': any;
      'sp-tab': any;
      'sp-tab-panel': any;
      'sp-textfield': any;
      'sp-textarea': any;
    }
  }
}
import '../styles/formula.css';
import { compile } from '../services/formulaEngine';
import {
  loadPresets,
  savePreset,
  deletePreset,
  exportPresetsToFile,
  importPresetsFromFile,
  type PresetItem
} from '../services/presetService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any 
declare const _require: any;

function useLayerList() {
  type LayerInfo = { id: string; name: string };
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [baseLayerId, setBaseLayerId] = useState<string | null>(null);
  const [blendLayerId, setBlendLayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  const fetchLayers = async () => {
    setLoading(true);
    setError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ps = _require('photoshop');
      const app = ps.app;
      const doc = app.activeDocument;
      if (!doc) {
        setLayers([]);
        setBaseLayerId(null);
        setBlendLayerId(null);
        return;
      }
      // 最小可用：展开两层，避免深度递归带来的性能问题
      const flatten = (ls: any[], out: LayerInfo[], depth = 0) => {
        for (const l of ls || []) {
          const name = String(l.name ?? '图层');
          if (l.layers && l.layers.length && depth < 2) {
            flatten(l.layers, out, depth + 1);
          } else {
            out.push({ id: String(l.id), name });
          }
        }
      };
      const list: LayerInfo[] = [];
      flatten(doc.layers || [], list);
      setLayers(list);
      if (!baseLayerId || !list.find(l => l.id === baseLayerId)) {
        setBaseLayerId(list[0]?.id ?? null);
      }
      if (!blendLayerId || !list.find(l => l.id === blendLayerId)) {
        setBlendLayerId(list[1]?.id ?? list[0]?.id ?? null);
      }
    } catch (e: any) {
      setError(e?.message || '无法获取图层列表');
      setLayers([]);
      setBaseLayerId(null);
      setBlendLayerId(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    fetchLayers();
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ps = _require('photoshop');
        const { action } = ps;
        const events = ['make', 'set', 'delete', 'select', 'open', 'close'];
        const unsubs: Array<() => void> = [];
        if (action && typeof action.addNotificationListener === 'function') {
          for (const ev of events) {
            try {
              const maybeUnsub = await action.addNotificationListener(ev, () => {
                if (!alive) return;
                if (debounceRef.current) {
                  clearTimeout(debounceRef.current);
                }
                debounceRef.current = setTimeout(() => { if (alive) fetchLayers(); }, 200) as unknown as number;
              });
              if (typeof maybeUnsub === 'function') unsubs.push(maybeUnsub);
            } catch {}
          }
        }
        // 兜底：2s 轮询，防止某些版本监听不到
        const timer = setInterval(() => { if (alive) fetchLayers(); }, 2000);
        unsubs.push(() => clearInterval(timer));
        return () => { alive = false; unsubs.forEach(u => { try { u(); } catch {} }); };
      } catch {
        const timer = setInterval(() => { if (alive) fetchLayers(); }, 2000);
        return () => { alive = false; clearInterval(timer); };
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { layers, baseLayerId, blendLayerId, setBaseLayerId, setBlendLayerId, loading, error };
}

function usePresets() {
  const [presets, setPresets] = useState<PresetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await loadPresets();
      setPresets(items);
    } catch (e: any) {
      setError(e?.message || '读取预设失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  return { presets, setPresets, loading, error, reload };
}

const MainPanel: React.FC = () => {
  // 顶部：基底/混合图层选择
  const { layers, baseLayerId, blendLayerId, setBaseLayerId, setBlendLayerId, loading: layersLoading, error: layersError } = useLayerList();

  // 中部：预设/新公式
  const { presets, reload: reloadPresets, loading: presetsLoading, error: presetError } = usePresets();
  const [tabKey, setTabKey] = useState<'preset' | 'custom'>('preset');
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const selectedPreset = useMemo(() => presets.find(p => p.id === selectedPresetId) || null, [presets, selectedPresetId]);

  const [nameInput, setNameInput] = useState('自定义公式');
  const [exprInput, setExprInput] = useState('[rs, gs, bs]');
  const [exprError, setExprError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  // 初始选中第一个预设
  useEffect(() => {
    if (presets.length && selectedPresetId == null) {
      setSelectedPresetId(presets[0].id);
    }
  }, [presets, selectedPresetId]);

  useEffect(() => {
    if (tabKey === 'preset' && selectedPreset) {
      setExprInput(selectedPreset.formula.expr);
    }
  }, [tabKey, selectedPreset]);

  // 校验表达式（轻量，避免高频编译）
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        compile(exprInput); // 仅编译以校验合法性
        setExprError(null);
      } catch (e: any) {
        setExprError(e?.message || '公式无效');
      }
    }, 250);
    return () => clearTimeout(t);
  }, [exprInput]);

  const onSavePreset = async () => {
    setStatus('');
    if (tabKey !== 'custom') {
      setStatus('请切换到“新公式”以保存为预设');
      return;
    }
    if (!nameInput.trim()) {
      setStatus('预设名称不能为空');
      return;
    }
    try {
      compile(exprInput);
    } catch (e: any) {
      setStatus(`无法保存：${e?.message || '公式无效'}`);
      return;
    }
    try {
      await savePreset(nameInput.trim(), exprInput.trim());
      await reloadPresets();
      setStatus('已保存到预设');
      setTabKey('preset');
    } catch (e: any) {
      setStatus(`保存失败：${e?.message || '未知错误'}`);
    }
  };

  const onDeletePreset = async () => {
    setStatus('');
    if (!selectedPresetId) {
      setStatus('请选择需要删除的预设');
      return;
    }
    try {
      await deletePreset(selectedPresetId);
      await reloadPresets();
      setSelectedPresetId(null);
      setStatus('预设已删除');
    } catch (e: any) {
      setStatus(`删除失败：${e?.message || '未知错误'}`);
    }
  };

  const onExport = async () => {
    setStatus('');
    try {
      await exportPresetsToFile();
      setStatus('已导出到文件');
    } catch (e: any) {
      setStatus(`导出失败：${e?.message || '未知错误'}`);
    }
  };

  const onImport = async () => {
    setStatus('');
    try {
      await importPresetsFromFile();
      await reloadPresets();
      setStatus('已从文件导入');
    } catch (e: any) {
      setStatus(`导入失败：${e?.message || '未知错误'}`);
    }
  };

  const onApply = async () => {
    setStatus('');
    if (!baseLayerId || !blendLayerId) {
      setStatus('请选择基底图层与混合图层');
      return;
    }
    if (baseLayerId === blendLayerId) {
      setStatus('基底图层与混合图层不能相同');
      return;
    }
    try {
      const engine = compile(exprInput);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ps = _require('photoshop');
      const { action, core } = ps;
      const resultName = '自定义混合结果';
      await core.executeAsModal(async () => {
        await action.batchPlay([
          { _obj: 'make', _target: [{ _ref: 'layer' }], using: { _obj: 'pixelLayer' } }
        ], { synchronousExecution: true, modalBehavior: 'fail' });
        await action.batchPlay([
          { _obj: 'set', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], to: { _obj: 'layer', name: resultName } }
        ], { synchronousExecution: true, modalBehavior: 'fail' });
      }, { commandName: 'Create Result Layer' });

      // 占位：样例运行一次以校验公式
      const sample = engine({ rb: 0.5, gb: 0.5, bb: 0.5, ab: 1, rs: 0.2, gs: 0.4, bs: 0.6, as: 1 });
      if (!Array.isArray(sample)) throw new Error('返回值异常');
      setStatus(`已创建“${resultName}”图层，下一步将把计算像素写入该图层`);
    } catch (e: any) {
      setStatus(`应用失败：${e?.message || '未知错误'}`);
    }
  };

  return (
    <div className="app-container" style={{ width: '100%', height: '100%', display: 'flex' }}>
      <div className="panel">
        {/* 顶部：图层选择 */}
        <div className="section">
          <div className="section-title">选择图层</div>
          <div className="col">
            <sp-picker label="基底图层" value={baseLayerId || ''} disabled={layersLoading || !layers.length} onChange={(e: any) => setBaseLayerId(String(e.target.value))} style={{ width: '100%' }}>
              {layers.map(l => (<sp-menu-item key={l.id} value={l.id}>{l.name}</sp-menu-item>))}
            </sp-picker>
            <sp-picker label="混合图层" value={blendLayerId || ''} disabled={layersLoading || !layers.length} onChange={(e: any) => setBlendLayerId(String(e.target.value))} style={{ width: '100%' }}>
              {layers.map(l => (<sp-menu-item key={l.id} value={l.id}>{l.name}</sp-menu-item>))}
            </sp-picker>
            <div className="notice">图层变化会自动刷新，无需手动刷新</div>
          </div>
          {layersError ? <div className="error">{layersError}</div> : null}
        </div>

        {/* 中部：预设/新公式 */}
        <div className="section">
          <sp-tabs selected={tabKey} onChange={(e: any) => setTabKey(String((e.target as any).selected))}>
            <sp-tab value="preset">公式预设</sp-tab>
            <sp-tab value="custom">新公式</sp-tab>
            <sp-tab-panel value="preset">
              <div className="col">
                <sp-picker label="预设" value={selectedPresetId || ''} disabled={presetsLoading || !presets.length} onChange={(e: any) => setSelectedPresetId(String(e.target.value))}>
                  {presets.map(p => (<sp-menu-item key={p.id} value={p.id}>{p.name}</sp-menu-item>))}
                </sp-picker>
                <sp-textarea readonly value={selectedPreset?.formula.expr || ''} style={{ width: '100%', minHeight: '88px' }}></sp-textarea>
                {presetError ? <div className="error">{presetError}</div> : null}
                <div className="actions">
                  <div className="actions-left">
                    <sp-action-button emphasized onClick={onDeletePreset} disabled={!selectedPresetId}>删除选中预设</sp-action-button>
                  </div>
                  <div className="actions-right">
                    <sp-action-button onClick={onExport}>导出</sp-action-button>
                    <sp-action-button onClick={onImport}>导入</sp-action-button>
                  </div>
                </div>
              </div>
            </sp-tab-panel>
            <sp-tab-panel value="custom">
              <div className="col">
                <sp-textfield label="预设名称" value={nameInput} onInput={(e: any) => setNameInput(String(e.target.value))}></sp-textfield>
                <sp-textarea label="表达式（返回 [r,g,b] 或 [r,g,b,a]，范围0..1）" value={exprInput} onInput={(e: any) => setExprInput(String(e.target.value))} style={{ width: '100%', minHeight: '120px' }}></sp-textarea>
                {exprError ? <div className="error">{exprError}</div> : <div className="notice">支持变量：rb,gb,bb,ab, rs,gs,bs,as；函数：abs,min,max,floor,ceil,round,sqrt,pow,exp,log,clamp,mix,step,smoothstep,lum,saturate</div>}
                <div className="actions">
                  <div className="actions-left">
                    <sp-action-button emphasized onClick={onSavePreset} disabled={!!exprError || !nameInput.trim()}>保存为预设</sp-action-button>
                  </div>
                  <div className="actions-right">
                    <sp-action-button onClick={onExport}>导出</sp-action-button>
                    <sp-action-button onClick={onImport}>导入</sp-action-button>
                  </div>
                </div>
              </div>
            </sp-tab-panel>
          </sp-tabs>
        </div>

        {/* 底部：操作 */}
        <div className="section">
          <div className="actions">
            <div className={status.startsWith('应用失败') || status.startsWith('无法') ? 'error' : status ? 'success' : 'notice'}>
              {status || '选择“基底图层/混合图层”，并编写/选择公式后点击“应用”'}
            </div>
            <sp-action-button emphasized onClick={onApply} disabled={!!exprError || !exprInput.trim() || !baseLayerId || !blendLayerId}>应用</sp-action-button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MainPanel;