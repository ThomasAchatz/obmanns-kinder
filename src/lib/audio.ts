// Ein einziges Audio-Element für die ganze App.
// iPhones spielen Ton nur, wenn er einmal durch einen Fingertipp gestartet wurde.
// Deshalb wird das Element beim Tipp auf „Los geht's“ mit einem stillen Schnipsel
// „freigeschaltet“; danach darf es auch später ohne Tipp neue Songs abspielen.

const SILENT =
  "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU2LjM2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU2LjQxAAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN//MUZAMAAAGkAAAAAAAAA0gAAAAARTMu//MUZAYAAAGkAAAAAAAAA0gAAAAAOTku//MUZAkAAAGkAAAAAAAAA0gAAAAANVVV";

let el: HTMLAudioElement | null = null;
let unlocked = false;

export function audio(): HTMLAudioElement {
  if (!el) {
    el = new Audio();
    el.preload = "auto";
    el.setAttribute("playsinline", "");
  }
  return el;
}

/** Im Klick-Handler aufrufen (synchron), damit iOS späteres Abspielen erlaubt. */
export function unlockAudio() {
  if (unlocked) return;
  const a = audio();
  a.src = SILENT;
  a.play()
    .then(() => {
      a.pause();
      unlocked = true;
    })
    .catch(() => {
      /* dann muss der Spieler einmal auf die Platte tippen */
    });
}

/** Song ab Sekunde `offset` abspielen. Liefert false, wenn der Browser einen Tipp verlangt. */
export async function playClip(url: string, offset = 0): Promise<boolean> {
  const a = audio();
  if (a.src !== url) a.src = url;
  try {
    if (offset > 0.5) a.currentTime = offset;
  } catch {
    /* noch keine Metadaten, dann eben von vorn */
  }
  try {
    await a.play();
    return true;
  } catch {
    return false;
  }
}

export function stopClip() {
  if (!el) return;
  el.pause();
}
