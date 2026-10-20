#ifndef BF_STRING_H
#define BF_STRING_H
#include <stddef.h>

void *memset(void *d, int c, size_t n);
void *memcpy(void *restrict d, const void *restrict s, size_t n);
void *memmove(void *d, const void *s, size_t n);
int memcmp(const void *a, const void *b, size_t n);
size_t strlen(const char *s);

#endif
