import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "./firebase";

const MANUT_DOCS_PREFIX = "manutencao-docs";
const MANUT_PRINTS_PREFIX = "manutencao-prints";

export interface ManutencaoArquivo {
  url: string;
  titulo: string;
  path?: string;
  contentType?: string;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function buildDisposition(fileName: string): string {
  const fallback = safeSegment(fileName || "arquivo");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName || fallback)}`;
}

async function uploadManutencaoFile(prefix: string, selimp: string, file: File): Promise<ManutencaoArquivo> {
  const safeSelimp = safeSegment(selimp);
  const titulo = file.name.trim() || "arquivo";
  const safeName = safeSegment(titulo);
  const path = `${prefix}/${safeSelimp}/${Date.now()}-${safeName}`;
  const storageRef = ref(storage, path);
  const contentType = file.type || "application/octet-stream";
  await uploadBytes(storageRef, file, {
    contentType,
    contentDisposition: buildDisposition(titulo),
    customMetadata: { originalName: titulo },
  });
  return { url: await getDownloadURL(storageRef), titulo, path, contentType };
}

/**
 * Sobe o documento (PDF) que atesta o módulo em manutenção para o Firebase Storage
 * e retorna a URL de download.
 */
export async function uploadManutencaoDoc(selimp: string, file: File): Promise<string> {
  const uploaded = await uploadManutencaoDocArquivo(selimp, file);
  return uploaded.url;
}

export async function uploadManutencaoDocArquivo(selimp: string, file: File): Promise<ManutencaoArquivo> {
  return uploadManutencaoFile(MANUT_DOCS_PREFIX, selimp, file);
}

export async function uploadManutencaoPrint(selimp: string, dia: string, file: File): Promise<ManutencaoArquivo> {
  return uploadManutencaoFile(`${MANUT_PRINTS_PREFIX}/${safeSegment(dia)}`, selimp, file);
}

export async function deleteManutencaoArquivo(path?: string): Promise<void> {
  if (!path) return;
  await deleteObject(ref(storage, path));
}
