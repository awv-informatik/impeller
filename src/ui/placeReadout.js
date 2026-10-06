// Where the sketch's readout (the sweep and the bow) goes: next to the end handle, on the side of it
// away from the part, clear of every handle and of what else stands over the sheet, and inside the
// sheet. Where there is no room next to the handle (a small sheet), it goes to a corner of the sheet,
// where no handle ever is. It keeps the place it had while that still works, so that it does not hop
// about under the hand.
//
// All in the sheet's pixels: `sheet` its size (it is square), `box` the readout's [width, height],
// `handle` the end handle, `knobs` all the handles, `over` rectangles [left, top, right, bottom] to keep
// clear of, `last` the place it had. Returns where it goes: { x, y, place }.
const GAP = 26 // from the handle's centre to the readout
const CLEAR = 22 // how near a handle's centre the readout may come
const MARGIN = 6 // from the sheet's edges

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export function placeReadout({ sheet, box: [w, h], handle: [bx, by], knobs, over, last }) {
  const k = GAP * 0.7
  const places = [
    [bx + GAP, by - h / 2], // right of the handle
    [bx - GAP - w, by - h / 2], // left of it
    [bx - w / 2, by - GAP - h], // above it
    [bx - w / 2, by + GAP], // below it
    [bx + k, by - k - h], // and the four diagonals
    [bx - k - w, by - k - h],
    [bx + k, by + k],
    [bx - k - w, by + k],
    [MARGIN, MARGIN], // the sheet's corners
    [sheet - MARGIN - w, MARGIN],
    [MARGIN, sheet - MARGIN - h],
    [sheet - MARGIN - w, sheet - MARGIN - h],
  ]
  // (a place as it would stand: moved into the sheet where it sticks out of it)
  const inside = ([x, y]) => [clamp(x, MARGIN, sheet - MARGIN - w), clamp(y, MARGIN, sheet - MARGIN - h)]
  // (how far a point is from the readout standing at x, y)
  const away = ([px, py], x, y) => Math.hypot(Math.max(x - px, 0, px - x - w), Math.max(y - py, 0, py - y - h))
  // (the way out from the part's middle, through the handle)
  const out = [bx - sheet / 2, by - sheet / 2]
  const score = (place, i) => {
    const [x, y] = inside(place)
    const to = [x + w / 2 - bx, y + h / 2 - by]
    let v = (to[0] * out[0] + to[1] * out[1]) / ((Math.hypot(...out) || 1) * (Math.hypot(...to) || 1))
    for (const knob of knobs) if (away(knob, x, y) < CLEAR) v -= 10
    for (const [l, t, r, b] of over) if (x < r && x + w > l && y < b && y + h > t) v -= 10
    v -= 0.01 * Math.hypot(x - place[0], y - place[1]) // (it had to be moved in)
    v -= 0.004 * Math.max(0, away([bx, by], x, y) - GAP) // (it is far from the handle)
    return i === last ? v + 0.35 : v
  }
  const scores = places.map(score)
  const place = scores.indexOf(Math.max(...scores))
  const [x, y] = inside(places[place])
  return { x, y, place }
}
