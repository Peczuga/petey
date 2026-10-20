/* Minimal freestanding libc for building cubiomes to wasm32 (see ../libc.c). */
#ifndef BF_STDLIB_H
#define BF_STDLIB_H
#include <stddef.h>

void *malloc(size_t n);
void *calloc(size_t n, size_t sz);
void *realloc(void *p, size_t n);
void free(void *p);
_Noreturn void exit(int code);

static inline int abs(int x) { return x < 0 ? -x : x; }
static inline long labs(long x) { return x < 0 ? -x : x; }
static inline long long llabs(long long x) { return x < 0 ? -x : x; }

#endif
