/*
 * Just enough libc for the parts of cubiomes the base finder uses.
 * Built with -mbulk-memory, so the memory builtins below lower to
 * memory.fill / memory.copy instead of calling back into themselves.
 */
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>
#include <stdint.h>

extern unsigned char __heap_base;
static unsigned char *heap_top = &__heap_base;

/* Bump allocator: the 1.18+ code paths we call never allocate, so this
 * only exists to satisfy the linker for the older-version code. */
void *malloc(size_t n)
{
    n = (n + 15) & ~(size_t)15;
    unsigned char *p = heap_top;
    size_t have = __builtin_wasm_memory_size(0) * 65536;
    size_t need = (size_t)(p - (unsigned char*)0) + n;
    if (need > have)
    {
        size_t pages = (need - have + 65535) / 65536;
        if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1)
            return NULL;
    }
    heap_top = p + n;
    return p;
}

void *calloc(size_t n, size_t sz)
{
    void *p = malloc(n * sz);
    if (p)
        memset(p, 0, n * sz);
    return p;
}

void *realloc(void *p, size_t n)
{
    void *q = malloc(n);
    if (q && p)
        memmove(q, p, n);
    return q;
}

void free(void *p) { (void) p; }

_Noreturn void exit(int code) { (void) code; __builtin_trap(); }

int printf(const char *fmt, ...) { (void) fmt; return 0; }
int fprintf(FILE *f, const char *fmt, ...) { (void) f; (void) fmt; return 0; }
int puts(const char *s) { (void) s; return 0; }
int putchar(int c) { return c; }

void *memset(void *d, int c, size_t n) { return __builtin_memset(d, c, n); }
void *memcpy(void *restrict d, const void *restrict s, size_t n) { return __builtin_memcpy(d, s, n); }
void *memmove(void *d, const void *s, size_t n) { return __builtin_memmove(d, s, n); }

int memcmp(const void *a, const void *b, size_t n)
{
    const unsigned char *x = a, *y = b;
    for (size_t i = 0; i < n; i++)
        if (x[i] != y[i])
            return x[i] - y[i];
    return 0;
}

size_t strlen(const char *s)
{
    size_t n = 0;
    while (s[n])
        n++;
    return n;
}

/* clang rewrites pow(2.0, n) into ldexp(1.0, n). */
double ldexp(double x, int n)
{
    union { double d; uint64_t u; } f;
    while (n > 1023) { x *= 0x1p1023; n -= 1023; }
    while (n < -1022) { x *= 0x1p-1022; n += 1022; }
    f.u = (uint64_t)(n + 1023) << 52;
    return x * f.d;
}

double pow(double b, double e)
{
    if (e != __builtin_trunc(e))
        __builtin_trap();
    long long n = (long long) e;
    int neg = n < 0;
    if (neg)
        n = -n;
    double r = 1.0;
    while (n)
    {
        if (n & 1)
            r *= b;
        b *= b;
        n >>= 1;
    }
    return neg ? 1.0 / r : r;
}
