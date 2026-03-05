import { ref, uploadString, getDownloadURL, deleteObject, listAll } from "firebase/storage";
import { storage } from "./firebase";

const DEFESA_FOTOS_PREFIX = "defesa";

function base64ToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(";base64,");
  const contentType = parts[0].split(":")[1] || "image/png";
  const raw = atob(parts[1]);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return new Blob([arr], { type: contentType });
}

function isDataUrl(str: string): boolean {
  return str.startsWith("data:");
}

export interface FotosContestar {
  agente_sub: string[];
  rastreamento: string[];
  nosso_agente: string[];
}

async function uploadImage(bfsId: string, section: string, index: number, dataUrl: string): Promise<string> {
  const blob = base64ToBlob(dataUrl);
  const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/png" ? "png" : "webp";
  const path = `${DEFESA_FOTOS_PREFIX}/${bfsId}/${section}_${index}.${ext}`;
  const storageRef = ref(storage, path);
  await uploadString(storageRef, dataUrl, "data_url");
  return getDownloadURL(storageRef);
}

export async function uploadFotosToStorage(bfsId: string, fotos: FotosContestar): Promise<FotosContestar> {
  const uploadOne = async (section: keyof FotosContestar): Promise<string[]> => {
    const arr = fotos[section];
    const urls: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (isDataUrl(item)) {
        const url = await uploadImage(bfsId, section, i, item);
        urls.push(url);
      } else {
        urls.push(item);
      }
    }
    return urls;
  };

  const [agente_sub, rastreamento, nosso_agente] = await Promise.all([
    uploadOne("agente_sub"),
    uploadOne("rastreamento"),
    uploadOne("nosso_agente"),
  ]);

  return { agente_sub, rastreamento, nosso_agente };
}

export async function deleteFotosFromStorage(bfsId: string): Promise<void> {
  const folderRef = ref(storage, `${DEFESA_FOTOS_PREFIX}/${bfsId}`);
  try {
    const result = await listAll(folderRef);
    await Promise.all(result.items.map((itemRef) => deleteObject(itemRef)));
    for (const prefixRef of result.prefixes) {
      const subResult = await listAll(prefixRef);
      await Promise.all(subResult.items.map((itemRef) => deleteObject(itemRef)));
    }
  } catch {
    // folder may not exist
  }
}
