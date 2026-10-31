import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { Actions } from "./main";
import { Media, uid } from "./types";
import { getMedia, mutate } from "./store";
export function useMedia(id?: string) {
  const [loaded, setLoaded] = useState<{ id: string; data: string }>();
  useEffect(() => {
    let active = true;
    if (id)
      getMedia(id)
        .then((m) => {
          if (active && m) setLoaded({ id, data: m.data });
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);
  return loaded?.id === id ? loaded?.data : undefined;
}
export function MediaImage({ id, alt }: { id: string; alt: string }) {
  const data = useMedia(id);
  return data ? (
    <img
      className="sense-image"
      loading="lazy"
      decoding="async"
      src={data}
      alt={alt}
    />
  ) : (
    <p className="media-missing">正在读取本地图片…</p>
  );
}
export function MediaAudio({ id }: { id: string }) {
  const data = useMedia(id);
  return data ? <audio controls src={data} preload="none" /> : null;
}
export async function compressImage(file: File): Promise<Media> {
  if (
    !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)
  )
    throw Error("支持 JPG、PNG、WebP 或 GIF 图片");
  if (file.size > 20 * 1024 * 1024) throw Error("原图请小于 20 MB");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw Error("图片像素过大，请先缩小到 4000 万像素以内");
    const ratio = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("当前设备无法处理图片");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (const quality of [0.78, 0.6, 0.42]) {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      );
      if (blob && blob.size <= 250 * 1024) break;
    }
    if (!blob || blob.size > 250 * 1024)
      throw Error("压缩后仍超过 250 KB，请选择更简单的图片");
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(Error("图片读取失败"));
      r.readAsDataURL(blob!);
    });
    const id = uid(),
      ext = blob.type === "image/webp" ? "webp" : "png";
    return {
      id,
      path: `images/${id}.${ext}`,
      type: blob.type,
      data,
      bytes: blob.size,
    };
  } finally {
    bitmap.close();
  }
}
export function PicturePicker({
  entryId,
  senseId,
  hasImage,
  a,
}: {
  entryId: string;
  senseId: string;
  hasImage: boolean;
  a: Actions;
}) {
  const input = useRef<HTMLInputElement>(null),
    [working, setWorking] = useState(false);
  return (
    <div className="picture-picker">
      <button
        className="small outline"
        disabled={working}
        onClick={() => input.current?.click()}
      >
        <ImagePlus size={15} />
        {working ? "正在压缩…" : hasImage ? "更换图片" : "添加图片"}
      </button>
      <small>自动压缩，最长边 960 像素 · 每张最多 250 KB</small>
      <input
        hidden
        aria-label={"义项图片 " + senseId}
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setWorking(true);
          a.run(async () => {
            const media = await compressImage(file);
            await mutate((d) => {
              const s = d.entries
                .find((e) => e.id === entryId)
                ?.senses.find((s) => s.id === senseId);
              if (!s) throw Error("义项已变化，请重新打开");
              s.image = media.id;
              d.media.push(media);
              const used = new Set(
                d.entries.flatMap((e) => [
                  e.audio,
                  e.audioUS,
                  e.audioUK,
                  ...e.senses.map((s) => s.image),
                ]),
              );
              d.media = d.media.filter((m) => used.has(m.id));
            });
          }, "图片已保存，仅加载正在查看的媒体").finally(() =>
            setWorking(false),
          );
        }}
      />
    </div>
  );
}
