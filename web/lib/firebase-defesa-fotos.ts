import { ref, uploadBytes, getDownloadURL, deleteObject, listAll } from "firebase/storage";
import { storage } from "./firebase";

const DEFESA_FOTOS_PREFIX = "defesa";

/** Limite de aresta maior (px); fotos maiores são reduzidas mantendo proporção. */
const MAX_EDGE_PX = 1920;
const JPEG_QUALITY = 0.86;

function isDataUrl(str: string): boolean {
  return str.startsWith("data:");
}

export interface FotosContestar {
  agente_sub: string[];
  itens_fiscalizados: { item: string; proatividade: string; turno?: string; observacoes: string }[];
  nosso_agente: string[];
  setor_override?: string | null;
  cronograma_override?: string | null;
  frequencia_override?: string | null;
}

/** Redimensiona (se necessário) e exporta JPEG para reduzir upload e banda no Storage. */
function dataUrlToCompressedJpegBlob(dataUrl: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w <= 0 || h <= 0) {
        reject(new Error("Dimensões de imagem inválidas"));
        return;
      }
      if (w > MAX_EDGE_PX || h > MAX_EDGE_PX) {
        const scale = Math.min(MAX_EDGE_PX / w, MAX_EDGE_PX / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas não disponível"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Falha ao comprimir imagem"));
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    };
    img.onerror = () => reject(new Error("Falha ao carregar imagem"));
    img.src = dataUrl;
  });
}

async function uploadImage(bfsId: string, section: string, index: number, dataUrl: string): Promise<string> {
  const blob = await dataUrlToCompressedJpegBlob(dataUrl);
  const path = `${DEFESA_FOTOS_PREFIX}/${bfsId}/${section}_${index}.jpg`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
  return getDownloadURL(storageRef);
}

export async function uploadFotosToStorage(bfsId: string, fotos: FotosContestar): Promise<FotosContestar> {
  const uploadOne = async (section: "agente_sub" | "nosso_agente"): Promise<string[]> => {
    const arr = fotos[section];
    if (!Array.isArray(arr)) return [];
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

  const [agente_sub, nosso_agente] = await Promise.all([
    uploadOne("agente_sub"),
    uploadOne("nosso_agente"),
  ]);

  return {
    agente_sub,
    itens_fiscalizados: fotos.itens_fiscalizados ?? [],
    nosso_agente,
    setor_override: fotos.setor_override ?? undefined,
    cronograma_override: fotos.cronograma_override ?? undefined,
    frequencia_override: fotos.frequencia_override ?? undefined,
  };
}

async function deleteOneDefesaFolder(folderKey: string): Promise<void> {
  const folderRef = ref(storage, `${DEFESA_FOTOS_PREFIX}/${folderKey}`);
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

/** Remove pastas de fotos (ex.: chave por número BFS e legado por id da linha). */
export async function deleteFotosFromStorage(...folderKeys: string[]): Promise<void> {
  const unique = [...new Set(folderKeys.map((k) => k.trim()).filter(Boolean))];
  await Promise.all(unique.map((k) => deleteOneDefesaFolder(k)));
}
