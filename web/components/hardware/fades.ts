import { TREE, openness } from "@/lib/hardware/tree";

// Groups whose opacity follows the zoom: a part's children fading in as the
// part grows on screen (with their names), and its cover (a CPU's lid)
// fading out. Their opacity is set straight on the DOM on every camera move,
// so zooming needs no React render. A CSS variable would do the same without
// code, but every element under it would then have its style recomputed on
// every frame, which is what made zooming slow.

type Kind = "children" | "labels" | "cover";

interface Group {
  id: string;
  kind: Kind;
  /** The opacity last set, to skip writes that change nothing. */
  last: string;
}

export class Fades {
  private groups = new Map<SVGGElement, Group>();
  private refs = new Map<string, (el: SVGGElement | null) => () => void>();
  private k = 1;

  /** A ref callback for a part's fading group: it is faded at once, then on every zoom until it unmounts. */
  track(id: string, kind: Kind): (el: SVGGElement | null) => () => void {
    const name = `${kind} ${id}`;
    let ref = this.refs.get(name);
    if (!ref) {
      ref = (el) => {
        if (el) {
          const group = { id, kind, last: "" };
          this.groups.set(el, group);
          this.fade(el, group);
        }
        return () => {
          if (el) this.groups.delete(el);
        };
      };
      this.refs.set(name, ref);
    }
    return ref;
  }

  /** The camera's zoom changed: fade every group to match. */
  zoom(k: number): void {
    this.k = k;
    for (const [el, group] of this.groups) this.fade(el, group);
  }

  private fade(el: SVGGElement, group: Group): void {
    const part = TREE.byId.get(group.id);
    if (!part) return;
    const o = openness(part, this.k);
    // A lid is gone by the time the parts under it can be clicked (half faded in),
    // so a part shown not quite fully open never has a ghost of its lid over it.
    const value = (group.kind === "cover" ? Math.max(0, 1 - 2 * o) : o).toFixed(3);
    if (value === group.last) return;
    group.last = value;
    el.style.opacity = value;
  }
}
