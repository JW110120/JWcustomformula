import React, { useEffect, useMemo, useRef, useState } from 'react';
// 使用 Spectrum Web Components（sp-*），不再依赖 React Spectrum 组件。
// 为了在 TSX 中直接使用自定义元素，这里声明 IntrinsicElements。
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'sp-action-button': any;
      'sp-picker': any;
      'sp-menu': any;
      'sp-menu-item': any;
      'sp-menu-divider': any;
      'sp-radio-group': any;
      'sp-radio': any;
      'sp-textfield': any;
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
  const initializedRef = useRef(false);
  const PLUGIN_LAYER_NAMES = useRef(new Set<string>(['自定义混合结果']));

  const chooseDefaults = (list: LayerInfo[]) => {
    // 过滤掉插件创建的结果图层，避免误选
    const filtered = list.filter(l => !PLUGIN_LAYER_NAMES.current.has(l.name.trim()));
    const first = filtered[0] || list[0];
    const second = filtered[1] || list[1] || filtered[0] || list[0];
    return { firstId: first ? first.id : null, secondId: second ? second.id : null };
  };

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
        initializedRef.current = false; // 当文档关闭后，下次再打开需重新初始化默认选择
        return;
      }
      // 读取整棵文件树（图层树），提供完整选择能力
      const flatten = (ls: any[], out: LayerInfo[], depth = 0) => {
        for (const l of ls || []) {
          const name = String(l.name ?? '图层');
          out.push({ id: String(l.id), name: `${'\u00A0'.repeat(depth * 2)}${name}` });
          if (l.layers && l.layers.length) {
            flatten(l.layers, out, depth + 1);
          }
        }
      };
      const list: LayerInfo[] = [];
      flatten(doc.layers || [], list);
      setLayers(list);

      const existsBase = baseLayerId && list.some(l => l.id === baseLayerId);
      const existsBlend = blendLayerId && list.some(l => l.id === blendLayerId);

      if (!initializedRef.current) {
        // 仅首次初始化时设置默认值
        const { firstId, secondId } = chooseDefaults(list);
        if (!baseLayerId && firstId) setBaseLayerId(firstId);
        if (!blendLayerId && secondId) setBlendLayerId(secondId);
        initializedRef.current = true;
      } else {
        // 后续只在“当前选择已不存在”时回退，且回退时仍跳过插件结果图层
        if (!existsBase) {
          const { firstId } = chooseDefaults(list);
          if (firstId) setBaseLayerId(firstId);
        }
        if (!existsBlend) {
          const { secondId, firstId } = chooseDefaults(list);
          if (secondId) setBlendLayerId(secondId);
          else if (firstId) setBlendLayerId(firstId);
        }
      }
    } catch (e: any) {
      // 出错时仅记录错误，不要清空或重置用户当前选择，避免在执行期间被动切换到新建结果图层
      setError(e?.message || '无法获取图层列表');
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
  const [mode, setMode] = useState<'preset' | 'custom'>('custom');
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const selectedPreset = useMemo(() => presets.find(p => p.id === selectedPresetId) || null, [presets, selectedPresetId]);

  const [nameInput, setNameInput] = useState('');
  const [exprInput, setExprInput] = useState(''); // 初始为空，使用占位提示“请输入新公式”
  const [exprError, setExprError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  // 新增：缓存“新公式”模式下的输入值，便于在模式切换来回时恢复（保持占位符逻辑）
  const customNameCacheRef = useRef<string>('');
  const customExprCacheRef = useRef<string>('');

  // 新增：当状态为成功类提示时，数秒后自动恢复默认提示
  useEffect(() => {
    const isError = /失败|错误|无法|Error|Failed/i.test(status);
    if (status && !isError) {
      const t = setTimeout(() => setStatus(''), 2600);
      return () => clearTimeout(t);
    }
  }, [status]);

  // 默认选中新公式（强制一次），确保单选与界面一致
  useEffect(() => { setMode('custom'); }, []);  

  // 初始选中第一个预设（如果用户切到“预设”时使用）
  useEffect(() => {
    if (presets.length && selectedPresetId == null) {
      setSelectedPresetId(presets[0].id);
    }
  }, [presets, selectedPresetId]);

  useEffect(() => {
    if (mode === 'preset' && selectedPreset) {
      setExprInput(selectedPreset.formula.expr);
    }
  }, [mode, selectedPreset]);

  // 校验表达式（轻量，避免高频编译）
  useEffect(() => {
    const t = setTimeout(() => {
      if (!exprInput.trim()) { setExprError(null); return; }
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
    if (mode !== 'custom') {
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
      // 保存成功后切换到“公式预设”模式，确保单选按钮与内容一致
      switchMode('preset');
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
      const { action, core, app, imaging } = ps;
      const resultName = '自定义混合结果';

      // 创建结果图层（已加入重试逻辑）
      const runCreateResultLayer = async () => {
        const tryOnce = async () => {
          await core.executeAsModal(async () => {
            await action.batchPlay([
              { _obj: 'make', _target: [{ _ref: 'layer' }], using: { _obj: 'pixelLayer' } },
              { _obj: 'set', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], to: { _obj: 'layer', name: resultName } }
            ], {}); // 不要在 executeAsModal 里再指定 modalBehavior: 'wait'
          }, { commandName: 'Create Result Layer' });
        };
        let lastErr: any = null;
        for (let i = 0; i < 3; i++) {
          try { await tryOnce(); return; } catch (e: any) {
            lastErr = e; const msg = String(e?.message || e || '');
            if (/modal state/i.test(msg)) { await new Promise(r => setTimeout(r, 600)); continue; }
            throw e;
          }
        }
        throw lastErr;
      };

      try {
        await runCreateResultLayer();
      } catch (e: any) {
        setStatus(`创建结果图层失败：${e?.message || e}`);
        return;
      }

      // 读取两层像素，按公式计算并写入结果图层
      await core.executeAsModal(async () => {
        const doc = app.activeDocument;
        const w = Number(doc.width);
        const h = Number(doc.height);
        const targetBounds = { left: 0, top: 0, right: w, bottom: h };

        // 获取像素（整幅画布尺寸，RGBA 8bit）
        const basePx = await imaging.getPixels({ documentID: doc.id, layerID: Number(baseLayerId), bounds: targetBounds, colorSpace: 'RGBA' });
        const blendPx = await imaging.getPixels({ documentID: doc.id, layerID: Number(blendLayerId), bounds: targetBounds, colorSpace: 'RGBA' });
        const baseImg = basePx?.imageData || basePx;
        const blendImg = blendPx?.imageData || blendPx;
        const baseBuf = new Uint8Array(await baseImg.getData());
        const blendBuf = new Uint8Array(await blendImg.getData());

        const outBuf = new Uint8Array(w * h * 4);
        for (let i = 0, p = 0; i < w * h; i++, p += 4) {
          const rb = baseBuf[p] / 255;
          const gb = baseBuf[p + 1] / 255;
          const bb = baseBuf[p + 2] / 255;
          const ab = (baseBuf[p + 3] ?? 255) / 255;

          const rs = blendBuf[p] / 255;
          const gs = blendBuf[p + 1] / 255;
          const bs = blendBuf[p + 2] / 255;
          const as = (blendBuf[p + 3] ?? 255) / 255;

          const res = engine({ rb, gb, bb, ab, rs, gs, bs, as });
          const r = Math.round((res[0] ?? 0) * 255);
          const g = Math.round((res[1] ?? 0) * 255);
          const b = Math.round((res[2] ?? 0) * 255);
          const a = Math.round((res[3] !== undefined ? res[3] : 1) * 255);

          outBuf[p] = r; outBuf[p + 1] = g; outBuf[p + 2] = b; outBuf[p + 3] = a;
        }

        const outImgData = await imaging.createImageDataFromBuffer(outBuf, {
          width: w,
          height: h,
          components: 4,
          chunky: true,
          colorProfile: 'sRGB IEC61966-2.1',
          colorSpace: 'RGBA'
        });

        const resultLayer = app.activeDocument.activeLayers[0];
        await imaging.putPixels({
          documentID: doc.id,
          layerID: Number(resultLayer.id),
          targetBounds: targetBounds,
          imageData: outImgData
        });

        outImgData.dispose?.();
        baseImg.dispose?.();
        blendImg.dispose?.();
      }, { commandName: 'Apply Custom Formula' });

      setStatus(`已应用公式到图层“${resultName}”`);
    } catch (e: any) {
      setStatus(`应用失败：${e?.message || '未知错误'}`);
    }
  };

  // 新增：统一处理模式切换并在离开/返回“新公式”时缓存/恢复输入
  const switchMode = (next: 'preset' | 'custom') => {
    setMode((prev) => {
      if (prev === next) return prev;
      if (prev === 'custom' && next === 'preset') {
        // 进入预设模式前缓存自定义模式输入
        customNameCacheRef.current = nameInput;
        customExprCacheRef.current = exprInput;
        if (selectedPreset) {
          setExprInput(selectedPreset.formula.expr);
        }
      } else if (prev === 'preset' && next === 'custom') {
        // 返回自定义模式时恢复输入（若之前为空则保持为空，从而显示占位符）
        setNameInput(customNameCacheRef.current || '');
        setExprInput(customExprCacheRef.current || '');
      }
      return next;
    });
  };

  // 处理模式切换（兼容 change/input 以及不同宿主环境的事件细节）
  const handleModeChange = (e: any) => {
    const target = e?.currentTarget || e?.target;
    const next = target?.selected ?? target?.value ?? e?.detail?.value;
    if (next === 'preset' || next === 'custom') switchMode(next);
  };

  return (
    <div className="app-container">
      <div className="panel">
        {/* 顶部：图层选择 */}
        <div className="section">
          <div className="section-title">选择图层</div>
          <div className="col">
            {/* 先显示混合图层 */}
            <div className="form-row">
              <div className="label">混合图层</div>
              <div className="control">
                <sp-picker size="m" selects="single" className="picker-full" selected={blendLayerId || ''} {...(!layers.length ? { disabled: true } : {})} onChange={(e: any) => setBlendLayerId(String(e.target.value))} onInput={(e: any) => setBlendLayerId(String(e.target.value))}>
                  <sp-menu>
                    {layers.map(l => (<sp-menu-item key={l.id} value={l.id} selected={l.id === blendLayerId}>{l.name}</sp-menu-item>))}
                  </sp-menu>
                </sp-picker>
              </div>  
            </div>
            {/* 再显示基底图层 */}
            <div className="form-row">
              <div className="label">基底图层</div>
              <div className="control">
                <sp-picker size="m" selects="single" className="picker-full" selected={baseLayerId || ''} {...(!layers.length ? { disabled: true } : {})} onChange={(e: any) => setBaseLayerId(String(e.target.value))} onInput={(e: any) => setBaseLayerId(String(e.target.value))}>
                  <sp-menu>
                    {layers.map(l => (<sp-menu-item key={l.id} value={l.id} selected={l.id === baseLayerId}>{l.name}</sp-menu-item>))}
                  </sp-menu>
                </sp-picker>
              </div>
            </div>
          </div>
          {layersError ? <div className="error">{layersError}</div> : null}
        </div>

        {/* 中部：预设/新公式（切换单选） */}
        <div className="section">
          <sp-radio-group selected={mode} name="formulaMode" onChange={handleModeChange} onInput={handleModeChange}>
            <sp-radio value="preset">公式预设</sp-radio>
            <sp-radio value="custom">新公式</sp-radio>
          </sp-radio-group>

          {mode === 'preset' && (
            <div className="col">
              <div className="form-row">
                <div className="label">已有预设</div>
                <div className="control">
                  <sp-picker size="m" selects="single" className="picker-full" selected={selectedPresetId || ''} {...(presetsLoading || !presets.length ? { disabled: true } : {})} onChange={(e: any) => setSelectedPresetId(String(e.target.value))} onInput={(e: any) => setSelectedPresetId(String(e.target.value))}>
                    <sp-menu>
                      {presets.map(p => (<sp-menu-item key={p.id} value={p.id} selected={p.id === selectedPresetId}>{p.name}</sp-menu-item>))}
                    </sp-menu>
                  </sp-picker>
                </div>
              </div>

              {/* 新增：预览当前预设的公式内容 */}
              <div className="preset-preview" title={selectedPreset?.formula?.expr || ''}>
                {selectedPreset ? (selectedPreset.formula?.expr || '（该预设没有公式内容）') : '（未选择预设）'}
              </div>

              {presetError ? <div className="error">{presetError}</div> : null}
              <div className="actions">
                <div className="actions-left">
                  <sp-action-button emphasized onClick={onDeletePreset} {...(!selectedPresetId ? { disabled: true } : {})}>删除选中预设</sp-action-button>
                </div>
                <div className="actions-right">
                  <sp-action-button onClick={onExport}>导出</sp-action-button>
                  <sp-action-button onClick={onImport}>导入</sp-action-button>
                </div>
              </div>
            </div>
          )}

          {mode === 'custom' && (
            <div className="col">
              <div className="form-row">
                <div className="label">新建名称</div>
                <div className="control">
                  <sp-textfield className="textfield-full" value={nameInput} placeholder="请在此处命名" onInput={(e: any) => setNameInput(String(e.target.value))}></sp-textfield>
                </div>
              </div>
              <div className="form-row">
                <div className="label">新建公式</div>
                <div className="control">
                  <sp-textfield
                    className="textfield-full"
                    value={exprInput}
                    placeholder="请输入新公式"
                    onInput={(e: any) => setExprInput(String(e.target.value))}
                    title={`变量：\nB = 基底图层像素向量 [rb, gb, bb, ab]，T = 混合图层像素向量 [rs, gs, bs, as]\n示例：B+T（逐通道相加），\nB*0.5+T*0.5（平均），\nclamp(B+T,0,1)（相加并钳制）。\n\n函数：\nabs 绝对值；min 最小；max 最大；floor 向下取整；ceil 向上取整；round 四舍五入；\nsqrt 平方根；pow 幂；exp 指数；log 对数；\nclamp(x,lo,hi) 限幅；mix(a,b,t) 线性插值；\nstep(edge,x) 阶跃；smoothstep(e0,e1,x) 平滑阶跃；\nlum(r,g,b) 亮度；saturate(x) 限幅到0..1。`}
                  ></sp-textfield>
                </div>
              </div>
              {exprError ? <div className="error">{exprError}</div> : <div className="notice" title="在输入框悬停可查看变量与函数中文说明">在输入框悬停查看全部说明</div>}
              <div className="actions">
                <div className="actions-left">
                  <sp-action-button emphasized onClick={onSavePreset} {...((!!exprError || !nameInput.trim()) ? { disabled: true } : {})}>保存为预设</sp-action-button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部：操作 */}
        <div className="section">
          <div className="actions">
            <div className={`status ${/失败|错误|无法|Error|Failed/i.test(status) ? 'error' : status ? 'success' : 'notice'}`}>
              {status || '编写/选择公式后点击“应用”'}
            </div>
            <sp-action-button emphasized onClick={onApply} {...((!!exprError || !exprInput.trim() || !baseLayerId || !blendLayerId) ? { disabled: true } : {})}>应用</sp-action-button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MainPanel;