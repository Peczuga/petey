# Biome Base Finder

A browser tool for narrowing down where a base is on a Minecraft Java server
when you know the seed, roughly where the base is, and what its water looked like.

It draws the real overworld biome map for the seed (the
[cubiomes](https://github.com/Cubitect/cubiomes) generator compiled to
WebAssembly, running in your browser), and lets you switch biomes off until only
the places the base could be are left.

## Using it

Open `index.html`. It works straight from disk (double-click it) or from the
site once this folder is deployed (`/basefinder/`).

1. **World**: paste the seed (`/seed` in-game, or the text seed). Pick the
   version (default 1.21.4 and newer). Leave biome height on *Surface* unless the
   base is underground or in the sky.
2. **Check the seed is right**: stand somewhere in-game, press F3, and type
   those coordinates into *Check a spot*. The biome should match. If it doesn't,
   the seed or version is wrong, or the server doesn't use vanilla generation.
3. **Search area**: type the X/Z bounds you know, or use *Draw on map*.
4. **Water colour**: tap the colour the water at the base had. Only biomes with
   that water colour stay ticked. Tap more colours if you're unsure.
5. **Biomes**: untick anything else you can rule out (e.g. *Oceans*).
6. **Possible spots**: the big number is how much of the search area is left.
   The list shows each connected stretch of possible biome, biggest first. Tap
   one to fly there. *Rule out* a spot once you've checked it, or rule out a
   circle you've already flown over in *Ruled out*.

Map views: **Biomes** (normal biome colours), **Possible** (yellow = still
possible), **Water** (each biome drawn in its water colour).

Your settings, area and ruled-out zones are saved in the browser.

### Water colours (Java Edition)

| Water | Biomes |
| --- | --- |
| `#3F76E4` normal blue | every biome not listed below |
| `#617B64` | swamp |
| `#3A7A6A` | mangrove swamp |
| `#43D5EE` | warm ocean |
| `#45ADF2` | lukewarm ocean, deep lukewarm ocean |
| `#5DB7EF` | cherry grove |
| `#0E4ECF` | meadow |
| `#3D57D6` | cold ocean, deep cold ocean, snowy taiga, snowy beach |
| `#3938C9` | frozen ocean, deep frozen ocean, frozen river |
| `#76889D` | pale garden |

Water colour blends across biome borders (the Biome Blend video setting), so a
base on a border can show a mix. Bedrock clients use different water colours.

## How it works

- `wasm/bridge.c` exposes three functions on top of cubiomes: `bf_init` (seed,
  version), `bf_gen` (a grid of biomes, one sample per *step* blocks) and
  `bf_probe` (the exact biome at a block, like F3).
- *Surface* mode samples with the depth parameter at 0, which is the biome the
  terrain surface gets. *Y level* mode samples the full 3D biome at that height,
  so cave biomes appear.
- `app.js` runs a pool of web workers for map tiles and the area scan, then
  finds connected spots with a run-length union-find.

## Rebuilding the WebAssembly

`cubiomes-wasm.js` is generated and committed, so nothing needs building to use
the page. To rebuild it (e.g. after bumping cubiomes for a new Minecraft version):

```sh
cd basefinder/wasm
./build.sh   # needs clang with the wasm32 target and wasm-ld
```

The script clones cubiomes at a pinned commit and writes `../cubiomes-wasm.js`.
No Emscripten needed; `wasm/libc/` is the small libc subset cubiomes uses.
