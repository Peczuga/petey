/* cubiomes only prints on internal errors; output is discarded in wasm. */
#ifndef BF_STDIO_H
#define BF_STDIO_H
#include <stddef.h>

typedef struct BF_FILE FILE;
#define stdout ((FILE*)0)
#define stderr ((FILE*)0)

int printf(const char *fmt, ...);
int fprintf(FILE *f, const char *fmt, ...);
int puts(const char *s);
int putchar(int c);

#endif
