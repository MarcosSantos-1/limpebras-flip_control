import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "./firebase";

const MANUT_DOCS_PREFIX = "manutencao-docs";

/**
 * Sobe o documento (PDF) que atesta o módulo em manutenção para o Firebase Storage
 * e retorna a URL de download. O caminho é fixo por módulo (1 documento por módulo
 * em manutenção), então reenviar substitui o anterior.
 */
export async function uploadManutencaoDoc(selimp: string, file: File): Promise<string> {
  const safe = selimp.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const path = `${MANUT_DOCS_PREFIX}/${safe}.pdf`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type || "application/pdf" });
  return getDownloadURL(storageRef);
}
