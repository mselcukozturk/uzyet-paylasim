import { createHash } from 'node:crypto';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parsePracticeSync(sourceText: string) {
  let source: unknown;
  try {
    source = JSON.parse(sourceText);
  } catch {
    throw new Error('Geçersiz JSON.');
  }
  if (!record(source) || !Array.isArray(source.questions) || !Array.isArray(source.checkpoints)) {
    throw new Error('Gövde questions ve checkpoints dizileri içeren bir JSON nesnesi olmalı.');
  }

  const version = createHash('sha256').update(sourceText).digest('hex').slice(0, 16);
  const guids = new Set<string>();
  const questions = source.questions.map((item: unknown, i: number) => {
    if (!record(item)) throw new Error(`Geçersiz soru: satır ${i + 1}`);
    const guid = text(item.guid);
    if (!guid || guids.has(guid)) throw new Error(`Eksik veya mükerrer GUID: satır ${i + 1}`);
    const topic = text(item.konu);
    const modul = text(item.modul);
    const prompt = text(item.soru);
    if (!topic || !modul || !prompt) throw new Error(`Eksik konu/modul/soru: satır ${i + 1}`);
    if (!Array.isArray(item.siklar) || item.siklar.length < 2 || item.siklar.length > 4
      || !item.siklar.every((option: unknown) => typeof option === 'string')
      || typeof item.cevapIdx !== 'number' || !Number.isInteger(item.cevapIdx)
      || item.cevapIdx < 0 || item.cevapIdx >= item.siklar.length) {
      throw new Error(`Geçersiz cevap veya şıklar: satır ${i + 1}`);
    }
    guids.add(guid);
    return {
      guid, topic, modul, prompt, options: item.siklar.map(text), correctIndex: item.cevapIdx,
      explanation: text(item.aciklama), source: text(item.kaynak), version,
    };
  });

  const ids = new Set<string>();
  const checkpoints = source.checkpoints.map((item: unknown, i: number) => {
    if (!record(item)) throw new Error(`Geçersiz checkpoint: satır ${i + 1}`);
    const id = text(item.id);
    if (!id || ids.has(id)) throw new Error(`Eksik veya mükerrer checkpoint id: satır ${i + 1}`);
    if (!text(item.html)) throw new Error(`Boş checkpoint html: satır ${i + 1}`);
    ids.add(id);
    return {
      id, topic: text(item.konu), title: text(item.title), subtitle: text(item.subtitle),
      html: item.html as string, sira: i, version,
    };
  });
  return { version, questions, checkpoints };
}
