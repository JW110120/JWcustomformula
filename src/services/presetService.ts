/* 预设持久化服务：读/写/导入/导出，带重试与初始化默认预设 */
// 使用 UXP 提供的 require（由 webpack ProvidePlugin 注入 _require）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const _require: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const uxp: any = _require('uxp');

export type RGBFormula = {
  expr: string; // 单表达式返回 [r,g,b] 或 [r,g,b,a]
};

export type PresetItem = {
  id: string;
  name: string;
  formula: RGBFormula;
  createdAt: number;
};

export type PresetFile = {
  version: number;
  items: PresetItem[];
};

const FILE_NAME = 'formulas.json';
const VERSION = 1;

function makeId(): string {
  // 简易随机ID，避免额外依赖
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureDataFile(): Promise<{ file: any; folder: any }>{
  const fs = uxp.storage.localFileSystem;
  const dataFolder = await fs.getDataFolder();
  let file = await dataFolder.getEntry(FILE_NAME).catch(async () => {
    const f = await dataFolder.createFile(FILE_NAME, { overwrite: false });
    return f;
  });
  return { file, folder: dataFolder };
}

async function readJSONWithInit(): Promise<PresetFile> {
  const { file } = await ensureDataFile();
  try {
    const content = await file.read();
    if (!content || content.trim() === '') {
      const initial = defaultPresetFile();
      await writeJSON(initial);
      return initial;
    }
    const obj = JSON.parse(content);
    if (!obj.version || !Array.isArray(obj.items)) {
      const initial = defaultPresetFile();
      await backupCorrupted(file, content);
      await writeJSON(initial);
      return initial;
    }
    return obj as PresetFile;
  } catch (e) {
    const initial = defaultPresetFile();
    await writeJSON(initial);
    return initial;
  }
}

function defaultPresetFile(): PresetFile {
  return {
    version: VERSION,
    items: [
      {
        id: makeId(),
        name: '正常',
        formula: { expr: '[rs, gs, bs]' },
        createdAt: Date.now(),
      },
      {
        id: makeId(),
        name: '正片叠底',
        formula: { expr: '[rb*rs, gb*gs, bb*bs]' },
        createdAt: Date.now(),
      },
      {
        id: makeId(),
        name: '滤色',
        formula: { expr: '[rb + rs - rb*rs, gb + gs - gb*gs, bb + bs - bb*bs]' },
        createdAt: Date.now(),
      },
      {
        id: makeId(),
        name: '叠加',
        formula: { expr: '[rb<0.5?2*rb*rs:1-2*(1-rb)*(1-rs), gb<0.5?2*gb*gs:1-2*(1-gb)*(1-gs), bb<0.5?2*bb*bs:1-2*(1-bb)*(1-bs)]' },
        createdAt: Date.now(),
      },
    ],
  };
}

async function backupCorrupted(file: any, content: string) {
  try {
    const folder = await file.getParent();
    const name = `formulas_backup_${Date.now()}.json`;
    const backup = await folder.createFile(name, { overwrite: false });
    await backup.write(content);
  } catch {}
}

async function writeJSON(data: PresetFile, retry = 0): Promise<void> {
  const MAX_RETRY = 5;
  const RETRY_WAIT = Math.min(1000 * Math.pow(2, retry), 8000);
  const { file } = await ensureDataFile();
  try {
    await file.write(JSON.stringify(data, null, 2));
  } catch (e) {
    if (retry < MAX_RETRY) {
      await new Promise(r => setTimeout(r, RETRY_WAIT));
      return writeJSON(data, retry + 1);
    } else {
      // 最后一次仍失败则继续重试（满足“不要跳过，一直重复尝试直到成功为止”）
      await new Promise(r => setTimeout(r, 8000));
      return writeJSON(data, retry + 1);
    }
  }
}

export async function loadPresets(): Promise<PresetItem[]> {
  const data = await readJSONWithInit();
  return data.items;
}

export async function savePreset(name: string, expr: string): Promise<PresetItem[]> {
  const data = await readJSONWithInit();
  const item: PresetItem = { id: makeId(), name, formula: { expr }, createdAt: Date.now() };
  data.items.push(item);
  await writeJSON(data);
  return data.items;
}

export async function deletePreset(id: string): Promise<PresetItem[]> {
  const data = await readJSONWithInit();
  const next = data.items.filter(i => i.id !== id);
  data.items = next;
  await writeJSON(data);
  return data.items;
}

export async function exportPresetsText(): Promise<string> {
  const data = await readJSONWithInit();
  return JSON.stringify(data, null, 2);
}

export async function importPresetsFromText(jsonText: string): Promise<PresetItem[]> {
  const parsed = JSON.parse(jsonText) as PresetFile;
  if (!parsed || !parsed.version || !Array.isArray(parsed.items)) throw new Error('无效的预设文件');
  // 合并导入：按 name+expr 去重
  const cur = await readJSONWithInit();
  const key = (p: PresetItem) => `${p.name}__${p.formula.expr}`;
  const map = new Map<string, PresetItem>();
  [...cur.items, ...parsed.items.map(p => ({...p, id: makeId(), createdAt: Date.now()}))].forEach(p => {
    map.set(key(p), p);
  });
  cur.items = Array.from(map.values());
  await writeJSON(cur);
  return cur.items;
}

// 为 UI 提供导入/导出到文件系统的便捷方法
export async function exportPresetsToFile(): Promise<void> {
  const fs = uxp.storage.localFileSystem;
  const content = await exportPresetsText();
  const file = await fs.getFileForSaving('formulas.json');
  if (file) {
    await file.write(content);
  }
}

export async function importPresetsFromFile(): Promise<PresetItem[]> {
  const fs = uxp.storage.localFileSystem;
  const file = await fs.getFileForOpening({ types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
  if (!file) throw new Error('未选择文件');
  const text = await file.read();
  return importPresetsFromText(text);
}