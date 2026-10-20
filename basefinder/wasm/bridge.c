/*
 * WebAssembly entry points for the base finder, on top of cubiomes.
 * Only the 1.18+ (multi-noise) overworld is supported.
 */
#include "generator.h"
#include "biomenoise.h"
#include "layers.h"

#define EXPORT(name) __attribute__((export_name(#name)))

#define BF_MAX_CELLS (1024 * 1024)

static Generator g;
static int ready;
static unsigned char out[BF_MAX_CELLS];

EXPORT(bf_out) unsigned char *bf_out(void) { return out; }
EXPORT(bf_max_cells) int bf_max_cells(void) { return BF_MAX_CELLS; }

/* Seed is passed as two 32-bit halves so JS doesn't need BigInt interop. */
EXPORT(bf_init)
int bf_init(int mc, int large, uint32_t seed_lo, uint32_t seed_hi)
{
    ready = 0;
    if (mc < MC_1_18 || mc > MC_NEWEST)
        return 0;
    setupGenerator(&g, mc, large ? LARGE_BIOMES : 0);
    applySeed(&g, DIM_OVERWORLD, ((uint64_t) seed_hi << 32) | seed_lo);
    ready = 1;
    return 1;
}

/*
 * Fill out[w*h] (row-major, z rows) with the biome at the centre of each
 * step x step block cell starting at block (x0, z0). y is a block height.
 * With surface set, the depth parameter is left at 0, which picks the biome
 * the terrain surface gets regardless of how high or low that surface is.
 */
EXPORT(bf_gen)
int bf_gen(int x0, int z0, int w, int h, int step, int y, int surface)
{
    if (!ready || w <= 0 || h <= 0 || step <= 0 || (int64_t) w * h > BF_MAX_CELLS)
        return 0;
    uint32_t flags = surface ? SAMPLE_NO_DEPTH : 0;
    int y4 = y >> 2;
    int half = step >> 1;
    for (int j = 0; j < h; j++)
    {
        int z4 = (z0 + j * step + half) >> 2;
        unsigned char *row = out + (int64_t) j * w;
        for (int i = 0; i < w; i++)
        {
            int x4 = (x0 + i * step + half) >> 2;
            row[i] = (unsigned char) sampleBiomeNoise(&g.bn, NULL, x4, y4, z4, NULL, flags);
        }
    }
    return 1;
}

/* Biome at an exact block, including the voronoi zoom (what F3 shows). */
EXPORT(bf_probe)
int bf_probe(int x, int y, int z, int surface)
{
    if (!ready)
        return -1;
    int x4, y4, z4;
    voronoiAccess3D(g.sha, x, y, z, &x4, &y4, &z4);
    return sampleBiomeNoise(&g.bn, NULL, x4, y4, z4, NULL, surface ? SAMPLE_NO_DEPTH : 0);
}
