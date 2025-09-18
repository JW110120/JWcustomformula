import React, { useEffect, useMemo, useRef, useState } from 'react';
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

// 允许在下一行使用 any 类型（为了兼容 Photoshop UXP 的全局 _require 接口）
declare const _require: any;

/**
 * 用途：从界面组件触发的事件中安全地拿到“值”（比如下拉选项、单选框的选中内容）。
 * 背景：不同组件/环境里，值可能放在 e.detail.value、e.target.value 或 e.currentTarget.value 中。
 * 行为：依次尝试这些位置，拿到第一个有效值，最终返回字符串；如果没有取到，返回空字符串。
 * 读者提示：你可以把它理解为“通用的取值小助手”，避免因为组件不同而取不到值。
 */
// 统一从事件中获取 value 的工具，兼容不同宿主与 ShadowDOM 事件
const getEvtValue = (e: any): string => {
  try {
    // 优先：事件携带的 detail.value（Spectrum 组件常用）
    const dv = e?.detail?.value;
    if (dv !== undefined && dv !== null && dv !== '') return String(dv);

    const host = e?.currentTarget ?? e?.target;

    // 其次：sp-picker 暴露的 selectedItem（若存在则其 value 最可靠）
    const si = (host && (host as any).selectedItem) ? (host as any).selectedItem : undefined;
    const siv = si && (typeof si.value === 'string' ? si.value : (si?.getAttribute ? si.getAttribute('value') : undefined));
    if (siv) return String(siv);

    // 再次：直接读取宿主的 value 属性
    const hv = host?.value;
    if (hv !== undefined && hv !== null && hv !== '') return String(hv);

    // 回退：宿主 selected 可能是字符串、索引或元素；若为元素则读取其 value
    const hs: any = host?.selected;
    if (typeof hs === 'string' && hs !== '') return hs;
    if (hs && typeof hs === 'object') {
      const hsv = (hs as any).value ?? (typeof hs.getAttribute === 'function' ? hs.getAttribute('value') : undefined);
      if (hsv !== undefined && hsv !== null && hsv !== '') return String(hsv);
    }

    // 最后：target/currentTarget 的 value
    const tv = e?.target?.value;
    if (tv !== undefined && tv !== null && tv !== '') return String(tv);
    const cv = e?.currentTarget?.value;
    if (cv !== undefined && cv !== null && cv !== '') return String(cv);

    return '';
  } catch {
    return '';
  }
};

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
  // 新增：用于标记“候选项正在刷新”，在刷新期间忽略 Picker 的程序性 change/input
  const optionsUpdatingRef = useRef(false);
  // 新增：记录当前选中的“名称”（用于 id 丢失时按名称唯一匹配恢复）
  const baseSelNameRef = useRef<string | null>(null);
  const blendSelNameRef = useRef<string | null>(null);

  // 当选中 id 或列表变化时，更新“最近一次选择的名称”
  useEffect(() => {
    if (baseLayerId) {
      const n = layers.find(l => l.id === baseLayerId)?.name;
      if (n) baseSelNameRef.current = n;
    }
  }, [baseLayerId, layers]);
  useEffect(() => {
    if (blendLayerId) {
      const n = layers.find(l => l.id === blendLayerId)?.name;
      if (n) blendSelNameRef.current = n;
    }
  }, [blendLayerId, layers]);

  const chooseDefaults = (list: LayerInfo[]) => {
    /**
     * 作用：为“基底/混合图层”提供一组合理的默认值。
     * 做法：
     * - 过滤掉本插件创建的“自定义混合结果”图层，避免误把结果当作输入再次参与计算；
     * - 从剩余列表中取前两项作为默认选择（若不足两项则尽量回退）。
     */
    const filtered = list.filter(l => !PLUGIN_LAYER_NAMES.current.has(l.name.trim()));
    const first = filtered[0] || list[0];
    const second = filtered[1] || list[1] || filtered[0] || list[0];
    return { firstId: first ? first.id : null, secondId: second ? second.id : null };
  };

  /**
   * 作用：读取当前文档的“图层树”，并生成一个适合下拉选择的“扁平列表”。
   */
  const fetchLayers = async () => {
    setLoading(true);
    setError(null);
    try {
      const ps = _require('photoshop');
      const app = ps.app;
      const doc = app.activeDocument;
      optionsUpdatingRef.current = true; // 开始刷新候选项
      if (!doc) {
        setLayers([]);
        setBaseLayerId(null);
        setBlendLayerId(null);
        initializedRef.current = false;
        return;
      }
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
        initializedRef.current = true;
        // 首次初始化：若尚未有选中，按规则选择前两项作为默认值（过滤掉“自定义混合结果”）
        const { firstId, secondId } = chooseDefaults(list);
        if (!baseLayerId && firstId) setBaseLayerId(firstId);
        if (!blendLayerId && secondId) setBlendLayerId(secondId);
      } else {
        // 若选中 id 丢失，尝试用“同名唯一匹配”恢复；否则清空
        if (!existsBase && baseLayerId != null) {
          const name = baseSelNameRef.current?.trim();
          if (name) {
            const matches = list.filter(l => l.name.trim() === name);
            if (matches.length === 1) {
              setBaseLayerId(matches[0].id);
            } else {
              setBaseLayerId(null);
            }
          } else {
            setBaseLayerId(null);
          }
        }
        if (!existsBlend && blendLayerId != null) {
          const name = blendSelNameRef.current?.trim();
          if (name) {
            const matches = list.filter(l => l.name.trim() === name);
            if (matches.length === 1) {
              setBlendLayerId(matches[0].id);
            } else {
              setBlendLayerId(null);
            }
          } else {
            setBlendLayerId(null);
          }
        }
      }
    } catch (e: any) {
      setError(e?.message || '无法获取图层列表');
    } finally {
      setLoading(false);
      // 在一个宏任务后关闭刷新标记，避免由于 React 提交/宿主 diff 过程中产生的同步事件
      setTimeout(() => { optionsUpdatingRef.current = false; }, 0);
    }
  };

  /**
   * 作用：保持“图层列表”与 Photoshop 的实时变化同步，防止 UI 显示过期数据。
   * 何时触发：组件挂载时初始化一次；组件卸载时彻底清理。
   * 实现策略：
   * 1) 先主动拉取一次（fetchLayers），与当前文档对齐；
   * 2) 订阅 Photoshop 的图层/文档事件（make/set/delete/select/open/close），用 200ms 去抖合并多次事件后再刷新；
   * 3) 兜底：每 2 秒轮询一次，避免某些版本下事件收不到；
   * 4) 资源管理：使用 alive 标记与取消订阅列表（unsubs），在卸载时统一释放，避免内存泄漏与后台刷新。
   * 依赖说明：刻意不把 fetchLayers 塞进依赖，否则其函数地址变化会导致重复初始化。
   */
  useEffect(() => {
    // 第一步：先拉一次，面板一打开就和当前文档同步
    let alive = true;
    fetchLayers();
    (async () => {
      try {
        // 允许使用 require 语法（兼容 UXP/Photoshop 的模块加载方式）
        const ps = _require('photoshop');
        const { action } = ps;
        const events = ['make', 'set', 'delete', 'select', 'open', 'close'];
        // 监听 Photoshop 文档/图层相关事件，一旦发生变化就“去抖”刷新列表
        // 说明：make(新建)、set(属性变化/重命名)、delete(删除)、select(切换选中)、open/close(文档开关)
        const unsubs: Array<() => void> = [];
        if (action && typeof action.addNotificationListener === 'function') {
          for (const ev of events) {
            try {
              const maybeUnsub = await action.addNotificationListener(ev, () => {
                if (!alive) return;
                if (debounceRef.current) { clearTimeout(debounceRef.current); }
                debounceRef.current = setTimeout(() => { if (alive) fetchLayers(); }, 200) as unknown as number;
              });
              if (typeof maybeUnsub === 'function') unsubs.push(maybeUnsub);
            } catch {}
          }
        }
        const timer = setInterval(() => { if (alive) fetchLayers(); }, 2000);
        unsubs.push(() => clearInterval(timer));
        return () => { alive = false; unsubs.forEach(u => { try { u(); } catch {} }); };
      } catch {
        const timer = setInterval(() => { if (alive) fetchLayers(); }, 2000);
        return () => { alive = false; clearInterval(timer); };
      }
    })();
  }, []);

  return { layers, baseLayerId, blendLayerId, setBaseLayerId, setBlendLayerId, loading, error, optionsUpdatingRef };
}

function usePresets() {
  const [presets, setPresets] = useState<PresetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 新增：用于标记“预设候选项正在刷新”，刷新期间忽略 Picker 的程序性 change/input
  const optionsUpdatingRef = useRef(false);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      optionsUpdatingRef.current = true; // 开始刷新预设候选项
      const items = await loadPresets();
      setPresets(items);
    } catch (e: any) {
      setError(e?.message || '读取预设失败');
    } finally {
      setLoading(false);
      setTimeout(() => { optionsUpdatingRef.current = false; }, 0);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  return { presets, setPresets, loading, error, reload, optionsUpdatingRef };
}

const MainPanel: React.FC = () => {
  // 顶部：基底/混合图层选择
  const { layers, baseLayerId, blendLayerId, setBaseLayerId, setBlendLayerId, loading: layersLoading, error: layersError, optionsUpdatingRef: layerOptionsUpdatingRef } = useLayerList();

  // 中部：预设/新公式
  const { presets, reload: reloadPresets, loading: presetsLoading, error: presetError, optionsUpdatingRef: presetOptionsUpdatingRef } = usePresets();
  const [mode, setMode] = useState<'preset' | 'custom'>('custom');
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const selectedPreset = useMemo(() => presets.find(p => String(p.id) === String(selectedPresetId)) || null, [presets, selectedPresetId]);
  // 新增：记录最近一次选中的预设名称（用于 id 丢失时按名称唯一匹配恢复）
  const selectedPresetNameRef = useRef<string | null>(null);
  // 新增：预设下拉的元素引用，用于绑定原生事件，确保在 UXP 自定义元素下能拿到值
  const presetPickerRef = useRef<any>(null);
  // 新增：图层下拉的元素引用，改为通过原生事件保证取值稳定
  const basePickerRef = useRef<any>(null);
  const blendPickerRef = useRef<any>(null);

  const [nameInput, setNameInput] = useState('');
  const [exprInput, setExprInput] = useState(''); // 初始为空，使用占位提示“请输入新公式”
  const [exprError, setExprError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  // 新增：缓存“新公式”模式下的输入值，便于在模式切换来回时恢复（保持占位符逻辑）
  const customNameCacheRef = useRef<string>('');
  const customExprCacheRef = useRef<string>('');
  // 新增：单选组引用，用于在事件不携带值时直接读取当前选中值
  const modeGroupRef = useRef<any>(null);

  /**
   * 作用：自动收起“成功类”的状态提示。
   * 何时触发：当 status 变化时。
   * 逻辑：如果是成功/完成提示（非错误），延迟约 2.6 秒后清空，避免提示长期占位；错误信息则保留，便于排查。
   */
  useEffect(() => {
    const isError = /失败|错误|无法|Error|Failed/i.test(status);
    if (status && !isError) {
      const t = setTimeout(() => setStatus(''), 2600);
      return () => clearTimeout(t);
    }
  }, [status]);

  /**
   * 作用：统一面板的初始模式为“新公式”。
   * 原因：不同宿主/版本下初始值可能不一致，这里强制一次，避免界面与单选状态不一致。
   */
  useEffect(() => { setMode('custom'); }, []);

  // 移除默认选中第一项的逻辑：保持“未选择”就是真正未选择
  // 之前的逻辑会在 presets 列表刷新后，若 selectedPresetId 为 null，则强行选中 presets[0]
  // 这会导致进入预设模式时预览区出现意料之外的表达式。
  // useEffect(() => {
  //   if (presets.length && selectedPresetId == null) {
  //     setSelectedPresetId(presets[0].id);
  //   }
  // }, [presets, selectedPresetId]);

  /**
   * 作用：在“公式预设”模式下，自动把当前选中预设的公式填入输入框用于预览/编辑。
   * 注意：仅在模式为 preset 且确实有选中项时执行，避免误覆盖自定义输入。
   */
  // 移除：不再把预设表达式写入 exprInput，预览直接由 selectedPreset 驱动；应用时按 mode 选择表达式
  useEffect(() => { /* 预设模式下不再回写 exprInput，预览直接由 selectedPreset 驱动 */ }, [mode, selectedPreset]);

  /**
   * 作用：对输入的公式做“延时语法校验”，仅用于提示是否可编译。
   * 时机：你停止输入约 250ms 后触发（去抖处理）。
   * 原因：直接每次敲字都编译会卡顿；延时能在流畅与及时提醒之间取得平衡。
   */
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

  /**
   * 作用：删除当前选择的预设。
   * 保护：若未选择任何预设则给出提示；删除后刷新列表并清空当前选择。
   */
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

  /**
   * 作用：把全部预设另存为本地文件，便于备份/迁移。
   */
  const onExport = async () => {
    setStatus('');
    try {
      await exportPresetsToFile();
      setStatus('已导出到文件');
    } catch (e: any) {
      setStatus(`导出失败：${e?.message || '未知错误'}`);
    }
  };

  /**
   * 作用：从本地文件导入预设；导入成功后会刷新当前列表。
   */
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

  /**
   * 作用：根据当前公式，对选择的两层进行像素级计算，并把结果输出到一个新建的“自定义混合结果”图层。
   * 关键点：
   * - 在开始执行前，锁定并再次校验两端图层是否仍存在，避免在执行过程中被切换/删除导致失败；
   * - 使用 executeAsModal 包裹所有与文档状态相关的操作，符合 UXP 的模态规范；
   * - 创建结果图层时加入“最多重试 3 次”的机制，主要为应对 Photoshop 偶发的 modal state 冲突；
   * - 读取两层像素、逐像素执行公式、回写到结果图层，并在最后释放临时资源。
   */
  const onApply = async () => {
    setStatus('');
    if (!baseLayerId || !blendLayerId) {
      setStatus('请选择基底图层与混合图层');
      return;
    }

    // 根据模式决定使用哪段表达式：preset 使用当前选中预设；custom 使用输入框
    const exprToUse = (mode === 'preset' && selectedPreset)
      ? (selectedPreset.formula?.expr || '')
      : (exprInput || '');

    if (!exprToUse.trim()) {
      setStatus('公式为空，请先选择预设或输入公式');
      return;
    }

    // 允许两者相同，不再限制
    const baseId = baseLayerId;
    const blendId = blendLayerId;
    const baseExistsNow = layers.some(l => l.id === baseId);
    const blendExistsNow = layers.some(l => l.id === blendId);
    if (!baseExistsNow || !blendExistsNow) {
      setStatus('所选图层已不存在，请重新选择');
      return;
    }
    try {
      const engine = compile(exprToUse);
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- 允许使用 require 语法（兼容 UXP/Photoshop 的模块加载方式）
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
        const docIdNum = Number(doc.id);
        const parseUnit = (v: any) => {
          if (typeof v === 'number' && Number.isFinite(v)) return v;
          const s = String(v ?? '');
          const n = parseFloat(s);
          return Number.isFinite(n) ? n : 0;
        };
        let w = parseUnit((doc as any).width);
        let h = parseUnit((doc as any).height);
        if (!w || !h) {
          try {
            const b: any = (doc as any).bounds;
            const L = parseUnit(b?.left ?? b?.[0]);
            const T = parseUnit(b?.top ?? b?.[1]);
            const R = parseUnit(b?.right ?? b?.[2]);
            const B = parseUnit(b?.bottom ?? b?.[3]);
            w = Math.max(0, R - L);
            h = Math.max(0, B - T);
          } catch {}
        }
        // 文档像素尺寸（整数）
        const DOC_W = Math.max(1, Math.round(w));
        const DOC_H = Math.max(1, Math.round(h));

        const baseLayerID = Number(baseId);
        const blendLayerID = Number(blendId);
        if (!Number.isFinite(baseLayerID) || !Number.isFinite(blendLayerID)) {
          throw new Error('图层ID无效');
        }

        // 帮助函数：在图层树里按 id 查找图层
        const findLayerById = (ls: any[], id: number): any | null => {
          for (const l of ls || []) {
            if (Number(l.id) === id) return l;
            if (l.layers && l.layers.length) {
              const m = findLayerById(l.layers, id);
              if (m) return m;
            }
          }
          return null;
        };
        // 帮助：解析 bounds 为整数像素矩形，并做必要的扩展/收缩
        const toRect = (b: any) => {
          const L = Math.floor(parseUnit(b?.left ?? b?.[0]));
          const T = Math.floor(parseUnit(b?.top ?? b?.[1]));
          const R = Math.ceil(parseUnit(b?.right ?? b?.[2]));
          const B = Math.ceil(parseUnit(b?.bottom ?? b?.[3]));
          return { left: L, top: T, right: R, bottom: B };
        };
        const clampRect = (r: { left: number; top: number; right: number; bottom: number; }) => ({
          left: Math.max(0, Math.min(DOC_W, r.left)),
          top: Math.max(0, Math.min(DOC_H, r.top)),
          right: Math.max(0, Math.min(DOC_W, r.right)),
          bottom: Math.max(0, Math.min(DOC_H, r.bottom)),
        });
        const rectW = (r: { left: number; right: number; }) => Math.max(0, r.right - r.left);
        const rectH = (r: { top: number; bottom: number; }) => Math.max(0, r.bottom - r.top);
        const unionRect = (a: any, b: any) => ({
          left: Math.min(a.left, b.left),
          top: Math.min(a.top, b.top),
          right: Math.max(a.right, b.right),
          bottom: Math.max(a.bottom, b.bottom)
        });

        // 找到两个图层与其绝对 bounds
        const baseLayer = findLayerById((doc as any).layers, baseLayerID);
        const blendLayer = findLayerById((doc as any).layers, blendLayerID);
        if (!baseLayer || !blendLayer) throw new Error('无法找到指定图层');
        const baseRectDoc = clampRect(toRect((baseLayer as any).bounds));
        const blendRectDoc = clampRect(toRect((blendLayer as any).bounds));
        if (rectW(baseRectDoc) === 0 || rectH(baseRectDoc) === 0 || rectW(blendRectDoc) === 0 || rectH(blendRectDoc) === 0) {
          throw new Error('选中图层尺寸为空');
        }

        // 按各自图层的绝对 bounds 读取像素（RGBA/8bit）
        const baseSurf = await imaging
          .getPixels({ documentID: docIdNum, layerID: baseLayerID, bounds: baseRectDoc, colorSpace: 'RGB', pixelFormat: 'RGBA', componentSize: 8 })
          .catch((e: any) => { throw new Error('读取基底图层像素失败: ' + (e?.message || e)); });
        const blendSurf = await imaging
          .getPixels({ documentID: docIdNum, layerID: blendLayerID, bounds: blendRectDoc, colorSpace: 'RGB', pixelFormat: 'RGBA', componentSize: 8 })
          .catch((e: any) => { throw new Error('读取混合图层像素失败: ' + (e?.message || e)); });

        const baseAB = await baseSurf.imageData.getData();
        const blendAB = await blendSurf.imageData.getData();
        const baseBuf = new Uint8Array(baseAB);
        const blendBuf = new Uint8Array(blendAB);

        // 使用返回的图像尺寸为准
        const baseW = Math.max(1, Number((baseSurf.imageData as any).width));
        const baseH = Math.max(1, Number((baseSurf.imageData as any).height));
        const blendW = Math.max(1, Number((blendSurf.imageData as any).width));
        const blendH = Math.max(1, Number((blendSurf.imageData as any).height));

        // 计算每行步幅（row stride）
        const safeStride = (len: number, h: number, w: number) => {
          if (h <= 0) return w * 4;
          const s = Math.floor(len / h);
          if (s >= w * 4 && s % 4 === 0) return s;
          return w * 4;
        };
        const baseStride = safeStride(baseBuf.length, baseH, baseW);
        const blendStride = safeStride(blendBuf.length, blendH, blendW);

        // 计算联合写回区域（绝对坐标）
        const unionDoc = clampRect(unionRect(baseRectDoc, blendRectDoc));
        const UW = rectW(unionDoc);
        const UH = rectH(unionDoc);

        // 计算“联合区域坐标”到各自图层缓冲的偏移（以像素为单位）
        const deltaXB = baseRectDoc.left - unionDoc.left;
        const deltaYB = baseRectDoc.top - unionDoc.top;
        const deltaXS = blendRectDoc.left - unionDoc.left;
        const deltaYS = blendRectDoc.top - unionDoc.top;

        const outBuf = new Uint8Array(UW * UH * 4);
        for (let y = 0; y < UH; y++) {
          const rowOut = y * UW * 4;
          // 对应到各自源缓冲的行起点（可能为负，后面判断）
          const yb = y - deltaYB;
          const ys = y - deltaYS;
          const rowBase = yb * baseStride;
          const rowBlend = ys * blendStride;

          for (let x = 0; x < UW; x++) {
            const p = rowOut + x * 4;
            const xb = x - deltaXB;
            const xs = x - deltaXS;

            // 分别从两层取样；若越界则按完全透明处理
            let rb = 0, gb = 0, bb = 0, ab = 0;
            if (yb >= 0 && yb < baseH && xb >= 0 && xb < baseW) {
              const bi = rowBase + xb * 4;
              rb = (baseBuf[bi] ?? 0) / 255;
              gb = (baseBuf[bi + 1] ?? 0) / 255;
              bb = (baseBuf[bi + 2] ?? 0) / 255;
              ab = (baseBuf[bi + 3] ?? 0) / 255;
            }

            let rs = 0, gs = 0, bs = 0, as = 0;
            if (ys >= 0 && ys < blendH && xs >= 0 && xs < blendW) {
              const si = rowBlend + xs * 4;
              rs = (blendBuf[si] ?? 0) / 255;
              gs = (blendBuf[si + 1] ?? 0) / 255;
              bs = (blendBuf[si + 2] ?? 0) / 255;
              as = (blendBuf[si + 3] ?? 0) / 255;
            }

            // 预乘：将颜色按自身 alpha 乘权，确保“透明即无贡献”
            const prb = rb * ab; const pgb = gb * ab; const pbb = bb * ab;
            const prs = rs * as; const pgs = gs * as; const pbs = bs * as;

            const res = engine({ rb: prb, gb: pgb, bb: pbb, ab, rs: prs, gs: pgs, bs: pbs, as });

            // 输出 alpha：若公式未给出，使用标准 over（as + ab − as*ab）
            const aOut = Math.max(0, Math.min(1, (res[3] !== undefined ? res[3] : (as + ab - as * ab))));

            // 引擎返回的 r/g/b 按“预乘域”解释，再进行反预乘恢复至直通道
            const rp = Math.max(0, Math.min(1, Number(res[0] ?? 0)));
            const gp = Math.max(0, Math.min(1, Number(res[1] ?? 0)));
            const bp = Math.max(0, Math.min(1, Number(res[2] ?? 0)));

            // 物理上预乘色不应超过 alpha，这里做一次限幅，避免数值导致反预乘 > 1
            const rpClamped = Math.min(rp, aOut);
            const gpClamped = Math.min(gp, aOut);
            const bpClamped = Math.min(bp, aOut);

            const r = aOut > 0 ? Math.round((rpClamped / aOut) * 255) : 0;
            const g = aOut > 0 ? Math.round((gpClamped / aOut) * 255) : 0;
            const b = aOut > 0 ? Math.round((bpClamped / aOut) * 255) : 0;
            const a = Math.round(aOut * 255);

            outBuf[p] = r; outBuf[p + 1] = g; outBuf[p + 2] = b; outBuf[p + 3] = a;
          }
        }

        // 在“联合区域”的绝对位置写回，避免放到(0,0)
        const writeBounds = { left: unionDoc.left, top: unionDoc.top, right: unionDoc.right, bottom: unionDoc.bottom };

        const outImageData = await imaging.createImageDataFromBuffer(outBuf, {
          width: UW,
          height: UH,
          colorSpace: 'RGB',
          pixelFormat: 'RGBA',
          components: 4,
          componentSize: 8
        });

        const resultLayer = app.activeDocument.activeLayers[0];
        await imaging.putPixels({
          documentID: docIdNum,
          layerID: Number(resultLayer.id),
          imageData: outImageData,
          targetBounds: writeBounds
        }).catch((e: any) => { throw new Error('写入结果像素失败: ' + (e?.message || e)); });

        // 释放临时资源
        outImageData.dispose?.();
        baseSurf.imageData?.dispose?.();
        blendSurf.imageData?.dispose?.();
      }, { commandName: '正在生成自定义混合模式的结果，请稍等...' });

      setStatus(`已应用公式到图层“${resultName}”`);
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : (e?.message || '未知错误');
      setStatus(`应用失败：${msg}`);
    }
  };

  /**
   * 作用：统一处理“预设”和“新公式”模式切换；
   * 细节：离开“新公式”模式时会缓存输入，返回时自动恢复，避免误丢内容。
   */
  const switchMode = (next: 'preset' | 'custom') => {
    setMode((prev) => {
      if (prev === next) return prev;
      if (prev === 'custom' && next === 'preset') {
        // 进入预设模式前缓存自定义模式输入
        customNameCacheRef.current = nameInput;
        customExprCacheRef.current = exprInput;
        // 清空当前预设选择，保证进入预设模式时若未选择预设则表达式为空
        setSelectedPresetId(null);
      } else if (prev === 'preset' && next === 'custom') {
        // 返回自定义模式时恢复输入（若之前为空则保持为空，从而显示占位符）
        setNameInput(customNameCacheRef.current || '');
        setExprInput(customExprCacheRef.current || '');
      }
      return next;
    });
  };

  /**
   * 作用：处理单选组的变化事件，驱动模式切换。
   * 说明：UXP 组件的事件有时不带 value，这里通过 ref 兜底读取当前选中值。
   */
  const handleModeChange = (e: any) => {
    const v = getEvtValue(e);
    const group = modeGroupRef.current as any;
    const refVal = (group?.value ?? group?.selected ?? '').toString();
    const next = (v || refVal || '').toString();
    if (next !== 'preset' && next !== 'custom') return;
    if (next === mode) return;
    switchMode(next as any);
  };

  useEffect(() => {
    const group = modeGroupRef.current as any;
    try {
      if (group) {
        if (group.selected !== mode) group.selected = mode;
        if (group.value !== mode) group.value = mode;
      }
    } catch {}
  }, [mode]);

  // 通过原生事件监听，确保 sp-picker(已有预设) 的选中变化能可靠更新到 React 状态
  useEffect(() => {
    if (mode !== 'preset') return; // 仅在预设模式下监听
    const el = presetPickerRef.current as any;
    if (!el) return;
    const onEvt = (evt: any) => {
      // 仅忽略非用户触发的事件，避免在刷新候选项期间误丢用户点击
      if (evt && 'isTrusted' in evt && (evt as any).isTrusted === false) return;
      const v = getEvtValue({ ...evt, currentTarget: el, target: el });
      const direct = v
        || (el?.value ?? '')
        || (el?.selectedItem?.value ?? '')
        || (typeof el?.selected === 'object' ? (el.selected?.value || el.selected?.getAttribute?.('value') || '') : (el?.selected ?? ''));
      const next = direct ? String(direct) : '';
      setSelectedPresetId(next ? next : null);
    };
    el.addEventListener?.('change', onEvt);
    el.addEventListener?.('input', onEvt);
    el.addEventListener?.('sp-change', onEvt as any);
    return () => {
      el.removeEventListener?.('change', onEvt);
      el.removeEventListener?.('input', onEvt);
      el.removeEventListener?.('sp-change', onEvt as any);
    };
  }, [mode, presets]);

  // 新增：通过原生事件监听图层选择器，确保基底/混合图层与 React 状态严格同步
  useEffect(() => {
    const bindPicker = (el: any, setter: (v: string | null) => void) => {
      if (!el) return () => {};
      const onEvt = (evt: any) => {
        // 刷新候选项期间忽略程序性事件，防止覆盖用户选择
        if (layerOptionsUpdatingRef?.current) return;
        const v = getEvtValue({ ...evt, currentTarget: el, target: el });
        const direct = v
          || (el?.value ?? '')
          || (el?.selectedItem?.value ?? '')
          || (typeof el?.selected === 'object' ? (el.selected?.value || el.selected?.getAttribute?.('value') || '') : (el?.selected ?? ''));
        const next = direct ? String(direct) : '';
        setter(next ? next : null);
      };
      el.addEventListener?.('change', onEvt);
      el.addEventListener?.('input', onEvt);
      el.addEventListener?.('sp-change', onEvt as any);
      return () => {
        el.removeEventListener?.('change', onEvt);
        el.removeEventListener?.('input', onEvt);
        el.removeEventListener?.('sp-change', onEvt as any);
      };
    };
    const unbindBase = bindPicker(basePickerRef.current, (v) => setBaseLayerId(v));
    const unbindBlend = bindPicker(blendPickerRef.current, (v) => setBlendLayerId(v));
    return () => { unbindBase?.(); unbindBlend?.(); };
  }, [layers]);

  // 预览格式化：为运算符添加空格并放大显示，同时将历史写法中的 T 显示为 S（仅影响预览，不影响实际编译）
  const renderExprForPreview = (raw: string) => {
    const text = String(raw || '').replace(/\bT\b/g, 'S');
    const parts = text.split(/(\+|\-|\*|\/|%|\?|\:|,|<|>)/g);
    return parts.map((p, idx) => {
      if (/^[+\-*/%?:,<>]$/.test(p)) {
        return <span key={`op-${idx}`} className="op"> {p} </span>;
      }
      return <span key={`tk-${idx}`}>{p}</span>;
    });
  };

  return (
    <div className="app-container">
      <div className="panel">
        {/* 顶部：图层选择 */}
        <div className="section-header">
          <div className="section-title">选择图层</div>
          <div className="col">
            {/* 先显示混合图层 */}
            <div className="form-row">
              <div className="label">混合图层（S）</div>
              <div className="control">
                <sp-picker ref={blendPickerRef} size="m" selects="single" className="picker-full" value={blendLayerId ?? undefined} {...(!layers.length ? { disabled: true } : {})} onChange={(e: any) => { const v = getEvtValue(e); setBlendLayerId(v ? v : null); }} onInput={(e: any) => { const v = getEvtValue(e); setBlendLayerId(v ? v : null); }}>
                  <sp-menu>
                    {layers.map(l => (
                      <sp-menu-item key={l.id} value={l.id} onClick={() => setBlendLayerId(String(l.id))}>{l.name}</sp-menu-item>
                    ))}
                  </sp-menu>
                </sp-picker>
              </div>  
            </div>
            {/* 再显示基底图层 */}
            <div className="form-row">
              <div className="label">基底图层（B）</div>
              <div className="control">
                <sp-picker ref={basePickerRef} size="m" selects="single" className="picker-full" value={baseLayerId ?? undefined} {...(!layers.length ? { disabled: true } : {})} onChange={(e: any) => { const v = getEvtValue(e); setBaseLayerId(v ? v : null); }} onInput={(e: any) => { const v = getEvtValue(e); setBaseLayerId(v ? v : null); }}>
                  <sp-menu>
                    {layers.map(l => (
                      <sp-menu-item key={l.id} value={l.id} onClick={() => setBaseLayerId(String(l.id))}>{l.name}</sp-menu-item>
                    ))}
                  </sp-menu>
                </sp-picker>
              </div>
            </div>
          </div>
          {layersError ? <div className="error">{layersError}</div> : null}
        </div>

        {/* 中部：预设/新公式（切换单选） */}
        <div className={`section-body ${mode === 'custom' ? 'no-scroll' : ''}`}>
          <sp-radio-group ref={modeGroupRef} selected={mode} name="formulaMode" onChange={handleModeChange} onInput={handleModeChange}>
            <sp-radio value="custom" onClick={() => switchMode('custom')}>新公式</sp-radio>
            <sp-radio value="preset" onClick={() => switchMode('preset')}>公式预设</sp-radio>
          </sp-radio-group>

          {mode === "preset" && (
            <div className="col">
              <div className="form-row">
                <div className="label">已有预设</div>
                <div className="control">
                  <sp-picker ref={presetPickerRef} size="m" selects="single" className="picker-full" selected={selectedPresetId ?? undefined} value={selectedPresetId ?? undefined} {...(presetsLoading || !presets.length ? { disabled: true } : {})} onChange={(e: any) => { const v = getEvtValue(e); setSelectedPresetId(v ? v : null); }} onInput={(e: any) => { const v = getEvtValue(e); setSelectedPresetId(v ? v : null); }}>
                    <sp-menu>
                      {presets.map(p => (<sp-menu-item key={p.id} value={p.id} onClick={() => setSelectedPresetId(String(p.id))}>{p.name}</sp-menu-item>))}
                    </sp-menu>
                  </sp-picker>
                </div>
              </div>

              {selectedPreset && (selectedPreset.formula?.expr || '').trim() ? (
                <div className="preset-preview" title={selectedPreset?.formula?.expr || ''}>
                  {renderExprForPreview(selectedPreset.formula?.expr || '')}
                </div>
              ) : null}

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

          {mode === "custom" && (
            <div className="col">
              <div className="form-row">
                <div className="label">新建名称</div>
                <div className="control">
                  <sp-textfield className="textfield-full" value={nameInput} placeholder="请在此处命名" onInput={(e: any) => setNameInput(String((e as any).target?.value))}></sp-textfield>
                </div>
              </div>

              <div className="form-row">
                <div className="label">新建公式</div>
                <div className="control">
                  <sp-textfield
                    className="textfield-full"
                    value={exprInput}
                    placeholder="请输入新公式"
                    onInput={(e: any) => setExprInput(String((e as any).target?.value))}
                    title={`变量：\nB = 基底图层像素向量 [rb, gb, bb, ab]；S = 源图层像素向量 [rs, gs, bs, as]。\n通道标量：rb gb bb ab / rs gs bs as，范围 0..1。\n示例：B+S（逐通道相加），B*0.5+S*0.5（平均），clamp(B+S,0,1)（相加并钳制到 0..1）。\n\n函数与参数：\nabs(x) 绝对值；min(a,b)/max(a,b) 最小/最大；floor(x)/ceil(x)/round(x) 取整；\nsqrt(x) 平方根；pow(x,y) 幂；exp(x) 指数；log(x) 自然对数；\nclamp(x, lo, hi) 将 x 限制到 [lo,hi]；\nmix(a, b, t) 线性插值（t=0 得 a，t=1 得 b）；\nstep(edge, x) 阶跃函数（x<edge→0，否则 1）；\nsmoothstep(e0, e1, x) 平滑阶跃（x 在 e0..e1 平滑过渡）；\nlum(r, g, b) 亮度近似；saturate(x) 等同 clamp(x,0,1)。`}
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

        {/* 底部：操作（固定） */}
        <div className="section-footer">
          <div className="actions">
            <div className={`status ${/(失败|错误|无法|Error|Failed|不能相同|不存在|请选择|无效)/i.test(status) ? 'error' : status ? 'success' : 'notice'}`}>
              {status || '编写/选择公式后点击“应用”'}
            </div>
            <sp-action-button emphasized onClick={onApply} {
              ...((() => {
                if (mode === 'preset') {
                  const exprOk = !!(selectedPreset && (selectedPreset.formula?.expr || '').trim());
                  return (!exprOk || !baseLayerId || !blendLayerId) ? { disabled: true } : {};
                }
                return ((!!exprError || !exprInput.trim() || !baseLayerId || !blendLayerId) ? { disabled: true } : {});
              })())
            }>应用</sp-action-button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MainPanel;