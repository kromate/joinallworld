// The identity of the map frame (src/map3d/geo/frame.ts: origin 8°E 9°N, 10 units per km) AND of the city geometry drawn in it.
// A camera position kept before this changed (an older, differently shaped board, another origin or scale) is meaningless
// now and must be dropped, not restored: bump the last part whenever a city's real-world layout is redrawn.
// It is a literal here so that the first download does not import the map code; viewMemory.test.ts checks it still
// names the frame's constants.
export const CAMERA_FRAME = 'nigeria-frame:8,9,10:lagos-real-1'
