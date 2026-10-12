import { useEffect } from "react";

/**
 * Publishes the part of the screen that is actually visible as two CSS values on the page: --vvt (its top) and
 * --vvh (its height). iPhones slide the keyboard over a page without resizing it, which buries anything pinned to
 * the bottom, such as a form's Save button. Full-screen flows and pop-up forms size themselves from these values
 * so their buttons stay above the keyboard. Used once, at the top of the app.
 *
 * iPhones do not always announce the keyboard through the viewport's own events, so a field gaining or losing
 * focus also prompts a re-measure, straight away and again once the keyboard has finished moving.
 */
export function useVisibleArea() {
  useEffect(() => {
    const vv = window.visualViewport, root = document.documentElement;
    if (!vv) return;
    let last = vv.height, timers: number[] = [];
    const apply = () => {
      root.style.setProperty("--vvh", `${vv.height}px`);
      root.style.setProperty("--vvt", `${vv.offsetTop}px`);
      // The keyboard just came up: keep the field being typed in on screen.
      if (vv.height < last - 80) (document.activeElement as HTMLElement | null)?.scrollIntoView?.({ block: "center" });
      last = vv.height;
    };
    const settle = () => { apply(); timers.forEach(clearTimeout); timers = [150, 400, 800].map((ms) => window.setTimeout(apply, ms)); };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("resize", settle);
    document.addEventListener("focusin", settle);
    document.addEventListener("focusout", settle);
    return () => {
      timers.forEach(clearTimeout);
      vv.removeEventListener("resize", apply); vv.removeEventListener("scroll", apply);
      window.removeEventListener("resize", settle);
      document.removeEventListener("focusin", settle); document.removeEventListener("focusout", settle);
    };
  }, []);
}
