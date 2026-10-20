/* The basic operations map straight onto wasm instructions. */
#ifndef BF_MATH_H
#define BF_MATH_H

static inline double floor(double x) { return __builtin_floor(x); }
static inline double ceil(double x) { return __builtin_ceil(x); }
static inline double sqrt(double x) { return __builtin_sqrt(x); }
static inline double fabs(double x) { return __builtin_fabs(x); }
static inline double trunc(double x) { return __builtin_trunc(x); }
static inline float floorf(float x) { return __builtin_floorf(x); }
static inline float sqrtf(float x) { return __builtin_sqrtf(x); }
static inline float fabsf(float x) { return __builtin_fabsf(x); }
static inline double nan(const char *tag) { (void) tag; return __builtin_nan(""); }

/* Only ever called with integral exponents by cubiomes (e.g. pow(2.0, n)). */
double pow(double b, double e);
double ldexp(double x, int n);

#endif
