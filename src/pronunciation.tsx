import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { Entry } from "./types";
import { Actions } from "./main";
import * as piper from "./speech";
let sequence = 0;
let activeEntry = "";
export function stopPronunciation() {
  sequence++;
  activeEntry = "";
  document.querySelectorAll("audio").forEach((a) => a.pause());
  void piper.stop().catch(() => {});
}
export async function pronounce(
  entry: Entry,
  enabled: boolean,
  onLoading?: (loading: boolean) => void,
) {
  if (!enabled) return;
  stopPronunciation();
  activeEntry = entry.id;
  const ticket = sequence;
  try {
    onLoading?.(true);
    await piper.initialize();
    onLoading?.(false);
    if (ticket !== sequence) return;
    await piper.speak(entry.word);
  } finally {
    onLoading?.(false);
  }
}
function Speaker({
  entry,
  enabled,
  a,
  iconOnly = false,
}: {
  entry: Entry;
  enabled: boolean;
  a: Actions;
  iconOnly?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  useEffect(
    () => () => {
      if (activeEntry === entry.id) stopPronunciation();
    },
    [entry.id],
  );
  return (
    <>
      <button
        className={iconOnly ? "icon pronounce-icon" : "pronounce-word"}
        disabled={!enabled}
        aria-label={"朗读 " + entry.word}
        title="Piper 离线美式女声"
        onClick={() => a.run(() => pronounce(entry, enabled, setLoading))}
      >
        {!iconOnly && entry.word}
        <Volume2 size={iconOnly ? 18 : 22} />
      </button>
      {loading && (
        <small className="piper-loading" role="status">
          语音引擎加载中
        </small>
      )}
    </>
  );
}
export const PronounceWord = ({
  entry,
  enabled,
  a,
}: {
  entry: Entry;
  enabled: boolean;
  a: Actions;
}) => <Speaker entry={entry} enabled={enabled} a={a} />;
export const PronounceIcon = ({
  entry,
  enabled,
  a,
}: {
  entry: Entry;
  enabled: boolean;
  a: Actions;
}) => <Speaker entry={entry} enabled={enabled} a={a} iconOnly />;
