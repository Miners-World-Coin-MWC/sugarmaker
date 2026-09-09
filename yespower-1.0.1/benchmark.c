/*
 * Copyright 2013-2018 Alexander Peslyak
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */

/*
 * SugarMaker / Miners World Coin benchmark
 *
 * Supported algorithms:
 *
 *   YespowerMwc
 *   YespowerAdvc
 *
 * Example:
 *
 *   sugarmaker-benchmark --algo YespowerMwc --threads 4 --duration 30
 *   sugarmaker-benchmark --algo YespowerAdvc --threads 8 --duration 60
 *
 * The final BENCHMARK_RESULT line is intended to be machine-readable.
 */

#ifndef _WIN32
#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif
#endif

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <time.h>
#include <errno.h>
#include <inttypes.h>
#include <stdatomic.h>

#include "yespower.h"

#ifdef _WIN32

#include <windows.h>
#include <process.h>

typedef HANDLE benchmark_thread_t;

#else

#include <pthread.h>
#include <unistd.h>
#include <sys/utsname.h>

typedef pthread_t benchmark_thread_t;

#endif

/* ------------------------------------------------------------------------- */
/* Configuration                                                             */
/* ------------------------------------------------------------------------- */

#define DEFAULT_DURATION_SECONDS 30
#define DEFAULT_THREADS 1
#define INPUT_SIZE 80

#define MWC_PERS \
    "Mining made easy and accessible to all - Miners World Coin 2025"

#define ADVC_PERS \
    "Let the quest begin"

/* ------------------------------------------------------------------------- */
/* Benchmark algorithm definition                                            */
/* ------------------------------------------------------------------------- */

typedef struct {
    const char *name;
    yespower_version_t version;
    uint32_t N;
    uint32_t r;
    const uint8_t *pers;
    size_t perslen;
} benchmark_algorithm_t;

static const benchmark_algorithm_t ALGO_MWC = {
    .name = "YespowerMwc",
    .version = YESPOWER_1_0,
    .N = 2048,
    .r = 32,
    .pers = (const uint8_t *)MWC_PERS,
    .perslen = sizeof(MWC_PERS) - 1
};

static const benchmark_algorithm_t ALGO_ADVC = {
    .name = "YespowerAdvc",
    .version = YESPOWER_1_0,
    .N = 2048,
    .r = 32,
    .pers = (const uint8_t *)ADVC_PERS,
    .perslen = sizeof(ADVC_PERS) - 1
};

/* ------------------------------------------------------------------------- */
/* Timing                                                                    */
/* ------------------------------------------------------------------------- */

static uint64_t time_us(void)
{
#ifdef _WIN32

    static LARGE_INTEGER frequency;
    LARGE_INTEGER counter;

    if (frequency.QuadPart == 0)
        QueryPerformanceFrequency(&frequency);

    QueryPerformanceCounter(&counter);

    return (uint64_t)(
        ((long double)counter.QuadPart * 1000000.0L) /
        (long double)frequency.QuadPart
    );

#else

    struct timespec ts;

#ifdef CLOCK_MONOTONIC_RAW

    if (clock_gettime(CLOCK_MONOTONIC_RAW, &ts) != 0)

#endif

    {
        if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0)
            return 0;
    }

    return (uint64_t)ts.tv_sec * 1000000ULL +
        (uint64_t)ts.tv_nsec / 1000ULL;

#endif
}

/* ------------------------------------------------------------------------- */
/* Sleep helper                                                              */
/* ------------------------------------------------------------------------- */

static void sleep_milliseconds(unsigned int milliseconds);

/* ------------------------------------------------------------------------- */
/* Platform information                                                      */
/* ------------------------------------------------------------------------- */

static const char *get_os_name(void)
{
#ifdef _WIN32

    return "Windows";

#elif defined(__APPLE__)

    return "macOS";

#elif defined(__linux__)

    return "Linux";

#elif defined(__FreeBSD__)

    return "FreeBSD";

#elif defined(__OpenBSD__)

    return "OpenBSD";

#elif defined(__NetBSD__)

    return "NetBSD";

#else

    return "Unknown";

#endif
}

static const char *get_architecture(void)
{
#if defined(__x86_64__) || defined(_M_X64)

    return "x86_64";

#elif defined(__i386__) || defined(_M_IX86)

    return "i686";

#elif defined(__aarch64__) || defined(_M_ARM64)

    return "aarch64";

#elif defined(__arm__) || defined(_M_ARM)

    return "armv7l";

#elif defined(__riscv) && (__riscv_xlen == 64)

    return "riscv64";

#elif defined(__riscv) && (__riscv_xlen == 32)

    return "riscv32";

#elif defined(__powerpc64__)

    return "ppc64";

#elif defined(__powerpc__)

    return "ppc";

#else

    return "unknown";

#endif
}

/* ------------------------------------------------------------------------- */
/* CPU name helpers                                                          */
/* ------------------------------------------------------------------------- */

/*
 * Remove a substring from a string by shifting the remaining data left.
 */
static void remove_substring(char *buffer, size_t buffer_size,
    const char *substring)
{
    char *pos;

    if (!buffer || !substring || !substring[0])
        return;

    pos = strstr(buffer, substring);

    if (!pos)
        return;

    memmove(
        pos,
        pos + strlen(substring),
        strlen(pos + strlen(substring)) + 1
    );

    (void)buffer_size;
}

/*
 * Trim leading and trailing whitespace.
 */
static void trim_whitespace(char *buffer)
{
    char *start;
    char *end;
    size_t length;

    if (!buffer || !buffer[0])
        return;

    start = buffer;

    while (*start == ' ' ||
           *start == '\t' ||
           *start == '\r' ||
           *start == '\n') {
        start++;
    }

    if (start != buffer)
        memmove(buffer, start, strlen(start) + 1);

    length = strlen(buffer);

    if (length == 0)
        return;

    end = buffer + length - 1;

    while (end >= buffer &&
           (*end == ' ' ||
            *end == '\t' ||
            *end == '\r' ||
            *end == '\n')) {
        *end = '\0';

        if (end == buffer)
            break;

        end--;
    }
}

/*
 * Collapse repeated spaces and tabs into single spaces.
 */
static void normalize_spaces(char *buffer)
{
    char *src;
    char *dst;
    int previous_space = 0;

    if (!buffer)
        return;

    src = buffer;
    dst = buffer;

    while (*src) {
        if (*src == ' ' || *src == '\t') {
            if (!previous_space) {
                *dst++ = ' ';
                previous_space = 1;
            }
        } else {
            *dst++ = *src;
            previous_space = 0;
        }

        src++;
    }

    *dst = '\0';

    trim_whitespace(buffer);
}

/*
 * Convert a platform CPU string into a cleaner human-readable name.
 *
 * Examples:
 *
 *   Intel(R) Core(TM) i5-8365U CPU @ 1.60GHz
 *       -> Intel Core i5-8365U
 *
 *   AMD Ryzen(TM) 5 5600X 6-Core Processor
 *       -> AMD Ryzen 5 5600X 6-Core
 */
static void clean_cpu_name(char *buffer)
{
    char *pos;

    if (!buffer || !buffer[0])
        return;

    /*
     * Remove common trademark / registration markers.
     */
    remove_substring(buffer, 512, "(R)");
    remove_substring(buffer, 512, "(TM)");
    remove_substring(buffer, 512, "(C)");

    /*
     * Intel commonly reports:
     *
     * Intel(R) Core(TM) i5-8365U CPU @ 1.60GHz
     *
     * The frequency is not useful for identifying the CPU model, so remove
     * everything beginning with " CPU @".
     */
    pos = strstr(buffer, " CPU @");

    if (pos)
        *pos = '\0';

    /*
     * Some platforms may use:
     *
     * CPU @ 3.20GHz
     *
     * without a preceding model suffix.
     */
    pos = strstr(buffer, " @ ");

    if (pos)
        *pos = '\0';

    trim_whitespace(buffer);

    /*
     * Remove a trailing " CPU".
     */
    {
        size_t len = strlen(buffer);

        if (len >= 4 &&
            !strcmp(buffer + len - 4, " CPU")) {
            buffer[len - 4] = '\0';
            trim_whitespace(buffer);
        }
    }

    /*
     * Remove a trailing " Processor" where it is clearly a generic suffix.
     */
    {
        size_t len = strlen(buffer);
        const char *suffix = " Processor";
        size_t suffix_len = strlen(suffix);

        if (len >= suffix_len &&
            !strcmp(buffer + len - suffix_len, suffix)) {
            buffer[len - suffix_len] = '\0';
            trim_whitespace(buffer);
        }
    }

    normalize_spaces(buffer);
}

/* ------------------------------------------------------------------------- */
/* CPU name detection                                                        */
/* ------------------------------------------------------------------------- */

static void get_cpu_name(char *buffer, size_t buffer_size)
{
    if (!buffer || buffer_size == 0)
        return;

    buffer[0] = '\0';

#ifdef _WIN32

    /*
     * Windows provides the actual processor marketing name through:
     *
     * HKEY_LOCAL_MACHINE
     *   \HARDWARE\DESCRIPTION\System\CentralProcessor\0
     *       ProcessorNameString
     *
     * This is much more useful than PROCESSOR_IDENTIFIER, which normally
     * returns strings such as:
     *
     *   Intel64 Family 6 Model 142 Stepping 12, GenuineIntel
     */
    {
        HKEY key;
        LONG status;
        char cpu_name[512];
        DWORD type = 0;
        DWORD size = sizeof(cpu_name);

        memset(cpu_name, 0, sizeof(cpu_name));

        status = RegOpenKeyExA(
            HKEY_LOCAL_MACHINE,
            "HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0",
            0,
            KEY_READ,
            &key
        );

        if (status == ERROR_SUCCESS) {

            status = RegQueryValueExA(
                key,
                "ProcessorNameString",
                NULL,
                &type,
                (LPBYTE)cpu_name,
                &size
            );

            RegCloseKey(key);

            if (status == ERROR_SUCCESS &&
                (type == REG_SZ || type == REG_EXPAND_SZ) &&
                cpu_name[0]) {

                snprintf(
                    buffer,
                    buffer_size,
                    "%s",
                    cpu_name
                );

                trim_whitespace(buffer);
                clean_cpu_name(buffer);

                if (buffer[0])
                    return;
            }
        }
    }

    /*
     * Fallback for unusual Windows environments where the registry value
     * is unavailable.
     */
    {
        const char *cpu = getenv("PROCESSOR_IDENTIFIER");

        if (cpu && cpu[0]) {
            snprintf(
                buffer,
                buffer_size,
                "%s",
                cpu
            );

            trim_whitespace(buffer);

            if (buffer[0])
                return;
        }
    }

#elif defined(__APPLE__)

    /*
     * Intel macOS:
     *
     *   sysctl -n machdep.cpu.brand_string
     *
     * Apple Silicon does not expose that Intel-specific key, so we fall
     * back to system_profiler and look for the "Chip:" field.
     */
    {
        FILE *fp;
        char line[512];

        fp = popen(
            "sysctl -n machdep.cpu.brand_string 2>/dev/null",
            "r"
        );

        if (fp) {

            if (fgets(line, sizeof(line), fp)) {

                trim_whitespace(line);

                if (line[0]) {

                    snprintf(
                        buffer,
                        buffer_size,
                        "%s",
                        line
                    );

                    pclose(fp);

                    clean_cpu_name(buffer);

                    if (buffer[0])
                        return;
                }
            }

            pclose(fp);
        }
    }

    /*
     * Apple Silicon fallback.
     *
     * Typical output:
     *
     *   Chip: Apple M2
     *
     * or:
     *
     *   Chip: Apple M4 Pro
     */
    {
        FILE *fp;
        char line[512];

        fp = popen(
            "system_profiler SPHardwareDataType 2>/dev/null",
            "r"
        );

        if (fp) {

            while (fgets(line, sizeof(line), fp)) {

                char *value;

                if (strncmp(line, "Chip:", 5) != 0 &&
                    strncmp(line, "Chip :", 6) != 0) {
                    continue;
                }

                value = strchr(line, ':');

                if (!value)
                    continue;

                value++;

                while (*value == ' ' || *value == '\t')
                    value++;

                trim_whitespace(value);

                if (value[0]) {

                    snprintf(
                        buffer,
                        buffer_size,
                        "%s",
                        value
                    );

                    pclose(fp);

                    clean_cpu_name(buffer);

                    if (buffer[0])
                        return;
                }
            }

            pclose(fp);
        }
    }

#elif defined(__linux__)

    /*
     * Linux normally exposes the CPU marketing name in /proc/cpuinfo.
     *
     * x86:
     *   model name : Intel(R) Core(TM) i5-8365U CPU @ 1.60GHz
     *
     * ARM systems may instead expose:
     *   Hardware
     *
     * or:
     *   Processor
     */
    {
        FILE *fp;

        fp = fopen("/proc/cpuinfo", "r");

        if (fp) {

            char line[512];

            while (fgets(line, sizeof(line), fp)) {

                char *colon;
                char *value;

                if (strncmp(line, "model name", 10) != 0 &&
                    strncmp(line, "Hardware", 8) != 0 &&
                    strncmp(line, "Processor", 9) != 0) {
                    continue;
                }

                colon = strchr(line, ':');

                if (!colon)
                    continue;

                value = colon + 1;

                while (*value == ' ' || *value == '\t')
                    value++;

                trim_whitespace(value);

                if (value[0]) {

                    snprintf(
                        buffer,
                        buffer_size,
                        "%s",
                        value
                    );

                    fclose(fp);

                    clean_cpu_name(buffer);

                    if (buffer[0])
                        return;
                }
            }

            fclose(fp);
        }
    }

#endif

    /*
     * Final fallback.
     *
     * The architecture is still useful if the operating system does not
     * expose a CPU model name.
     */
    snprintf(
        buffer,
        buffer_size,
        "%s",
        get_architecture()
    );
}

/* ------------------------------------------------------------------------- */
/* JSON helpers                                                              */
/* ------------------------------------------------------------------------- */

static void json_escape(FILE *fp, const char *str)
{
    const unsigned char *p;

    if (!fp)
        return;

    if (!str)
        str = "";

    p = (const unsigned char *)str;

    fputc('"', fp);

    while (*p) {

        switch (*p) {

        case '\\':
            fputs("\\\\", fp);
            break;

        case '"':
            fputs("\\\"", fp);
            break;

        case '\b':
            fputs("\\b", fp);
            break;

        case '\f':
            fputs("\\f", fp);
            break;

        case '\n':
            fputs("\\n", fp);
            break;

        case '\r':
            fputs("\\r", fp);
            break;

        case '\t':
            fputs("\\t", fp);
            break;

        default:

            if (*p < 0x20) {
                fprintf(
                    fp,
                    "\\u%04x",
                    (unsigned int)*p
                );
            } else {
                fputc(*p, fp);
            }

            break;
        }

        p++;
    }

    fputc('"', fp);
}

/* ------------------------------------------------------------------------- */
/* Timestamp                                                                 */
/* ------------------------------------------------------------------------- */

static void get_timestamp(char *buffer, size_t buffer_size)
{
    time_t now;
    struct tm tm_utc;

    if (!buffer || buffer_size == 0)
        return;

    buffer[0] = '\0';

    now = time(NULL);

#ifdef _WIN32

    if (gmtime_s(&tm_utc, &now) != 0)
        return;

#else

    if (!gmtime_r(&now, &tm_utc))
        return;

#endif

    strftime(
        buffer,
        buffer_size,
        "%Y-%m-%dT%H:%M:%SZ",
        &tm_utc
    );
}

/* ------------------------------------------------------------------------- */
/* Benchmark context                                                         */
/* ------------------------------------------------------------------------- */

typedef struct {

    const benchmark_algorithm_t *algorithm;

    unsigned int thread_count;
    unsigned int duration_seconds;

    uint64_t start_us;
    uint64_t end_us;

    atomic_int started;
    atomic_int running;
    atomic_int failed;

    uint64_t *hash_counts;

} benchmark_context_t;

typedef struct {

    benchmark_context_t *context;
    unsigned int thread_id;

} benchmark_worker_t;

/* ------------------------------------------------------------------------- */
/* Worker                                                                    */
/* ------------------------------------------------------------------------- */

#ifdef _WIN32

static unsigned __stdcall benchmark_worker(void *argument)

#else

static void *benchmark_worker(void *argument)

#endif
{
    benchmark_worker_t *worker;
    benchmark_context_t *ctx;

    unsigned int thread_id;

    uint8_t src[INPUT_SIZE];
    yespower_binary_t dst;

    uint64_t count = 0;

    uint32_t seed;

    unsigned int i;

    worker = (benchmark_worker_t *)argument;

    ctx = worker->context;
    thread_id = worker->thread_id;

    memset(src, 0, sizeof(src));

    /*
     * Give every worker a deterministic but different input.
     */
    seed = 0x9e3779b9U ^
        (thread_id * 0x85ebca6bU);

    for (i = 0; i < sizeof(src); i++) {

        src[i] = (uint8_t)(
            (i * 3U + thread_id * 17U) &
            0xffU
        );
    }

    src[76] = (uint8_t)(seed & 0xffU);
    src[77] = (uint8_t)((seed >> 8) & 0xffU);
    src[78] = (uint8_t)((seed >> 16) & 0xffU);
    src[79] = (uint8_t)((seed >> 24) & 0xffU);

    /*
     * Wait until every worker has been created and the benchmark timer
     * has started.
     */
    while (!atomic_load(&ctx->started)) {

        if (!atomic_load(&ctx->running))
            goto worker_done;

        sleep_milliseconds(1);
    }

    while (atomic_load(&ctx->running)) {

        uint64_t now;

        /*
         * Change the input for every hash. This prevents the benchmark
         * from repeatedly hashing exactly the same block.
         */
        src[76] = (uint8_t)(seed & 0xffU);
        src[77] = (uint8_t)((seed >> 8) & 0xffU);
        src[78] = (uint8_t)((seed >> 16) & 0xffU);
        src[79] = (uint8_t)((seed >> 24) & 0xffU);

        if (yespower_tls(
            src,
            sizeof(src),
            &(yespower_params_t){
                .version = ctx->algorithm->version,
                .N = ctx->algorithm->N,
                .r = ctx->algorithm->r,
                .pers = ctx->algorithm->pers,
                .perslen = ctx->algorithm->perslen
            },
            &dst
        )) {

            atomic_store(&ctx->failed, 1);
            atomic_store(&ctx->running, 0);

            break;
        }

        count++;

        seed = seed * 1664525U + 1013904223U;

        /*
         * Check the timer periodically rather than relying only on the
         * main thread. This allows workers to stop promptly.
         */
        if ((count & 0x3fU) == 0) {

            now = time_us();

            if (now >= ctx->end_us)
                atomic_store(&ctx->running, 0);
        }
    }

worker_done:

    ctx->hash_counts[thread_id] = count;

#ifdef _WIN32

    return 0;

#else

    return NULL;

#endif
}

/* ------------------------------------------------------------------------- */
/* Sleep implementation                                                       */
/* ------------------------------------------------------------------------- */

static void sleep_milliseconds(unsigned int milliseconds)
{
#ifdef _WIN32

    Sleep(milliseconds);

#else

    struct timespec ts;

    ts.tv_sec = milliseconds / 1000;
    ts.tv_nsec =
        (long)(milliseconds % 1000) *
        1000000L;

    while (nanosleep(&ts, &ts) != 0) {

        if (errno != EINTR)
            break;
    }

#endif
}

/* ------------------------------------------------------------------------- */
/* Algorithm lookup                                                          */
/* ------------------------------------------------------------------------- */

static const benchmark_algorithm_t *find_algorithm(const char *name)
{
    if (!name)
        return NULL;

    if (!strcmp(name, "YespowerMwc") ||
        !strcmp(name, "yespowermwc") ||
        !strcmp(name, "mwc") ||
        !strcmp(name, "MWC")) {

        return &ALGO_MWC;
    }

    if (!strcmp(name, "YespowerAdvc") ||
        !strcmp(name, "yespoweradvc") ||
        !strcmp(name, "advc") ||
        !strcmp(name, "ADVC")) {

        return &ALGO_ADVC;
    }

    return NULL;
}

/* ------------------------------------------------------------------------- */
/* Usage                                                                     */
/* ------------------------------------------------------------------------- */

static void print_usage(const char *program)
{
    printf(
        "\n"
        "SugarMaker Benchmark\n"
        "\n"
        "Usage:\n"
        "  %s --algo <algorithm> --threads <threads> --duration <seconds>\n"
        "\n"
        "Algorithms:\n"
        "  YespowerMwc\n"
        "  YespowerAdvc\n"
        "\n"
        "Options:\n"
        "  --algo       Algorithm to benchmark\n"
        "  --threads    Number of CPU threads\n"
        "  --duration   Benchmark duration in seconds\n"
        "  --output     JSON output filename\n"
        "  --help       Show this help\n"
        "\n"
        "Examples:\n"
        "  %s --algo YespowerMwc --threads 4 --duration 30\n"
        "  %s --algo YespowerAdvc --threads 8 --duration 60\n"
        "\n",
        program,
        program,
        program
    );
}

/* ------------------------------------------------------------------------- */
/* JSON output                                                               */
/* ------------------------------------------------------------------------- */

static int write_result_json(
    const char *filename,
    const benchmark_algorithm_t *algorithm,
    const char *cpu,
    const char *architecture,
    const char *os,
    unsigned int threads,
    double hashrate,
    double per_thread_hashrate,
    unsigned int duration,
    const char *timestamp)
{
    FILE *fp;

    fp = fopen(filename, "w");

    if (!fp) {

        fprintf(
            stderr,
            "ERROR: Could not create JSON output '%s': %s\n",
            filename,
            strerror(errno)
        );

        return 1;
    }

    fprintf(
        fp,
        "{\n"
        "  \"schema_version\": 1,\n"
        "  \"benchmark\": {\n"
        "    \"algorithm\": "
    );

    json_escape(fp, algorithm->name);

    fprintf(
        fp,
        ",\n"
        "    \"cpu\": "
    );

    json_escape(fp, cpu);

    fprintf(
        fp,
        ",\n"
        "    \"architecture\": "
    );

    json_escape(fp, architecture);

    fprintf(
        fp,
        ",\n"
        "    \"os\": "
    );

    json_escape(fp, os);

    fprintf(
        fp,
        ",\n"
        "    \"threads\": %u,\n"
        "    \"hashrate_hps\": %.2f,\n"
        "    \"per_thread_hps\": %.2f,\n"
        "    \"duration_seconds\": %u,\n"
        "    \"sugarmaker_version\": \"1.0.0\",\n"
        "    \"timestamp\": ",
        threads,
        hashrate,
        per_thread_hashrate,
        duration
    );

    json_escape(fp, timestamp);

    fprintf(
        fp,
        "\n"
        "  }\n"
        "}\n"
    );

    fclose(fp);

    return 0;
}

/* ------------------------------------------------------------------------- */
/* Main benchmark                                                            */
/* ------------------------------------------------------------------------- */

int main(int argc, const char *const *argv)
{
    const benchmark_algorithm_t *algorithm = NULL;

    unsigned int threads = DEFAULT_THREADS;
    unsigned int duration = DEFAULT_DURATION_SECONDS;

    const char *output_file =
        "benchmark-result.json";

    unsigned int i;

    char cpu[512];
    char timestamp[64];

    benchmark_context_t context;

    benchmark_thread_t *thread_handles = NULL;
    benchmark_worker_t *workers = NULL;

    uint64_t total_hashes = 0;
    uint64_t elapsed_us;

    double hashrate;
    double per_thread_hashrate;

    int result = 0;

    /* ------------------------------------------------------------------ */
    /* Parse arguments                                                     */
    /* ------------------------------------------------------------------ */

    for (i = 1; i < (unsigned int)argc; i++) {

        if (!strcmp(argv[i], "--help") ||
            !strcmp(argv[i], "-h")) {

            print_usage(argv[0]);
            return 0;
        }

        if (!strcmp(argv[i], "--algo") ||
            !strcmp(argv[i], "-a")) {

            if (i + 1 >= (unsigned int)argc) {

                fprintf(
                    stderr,
                    "ERROR: --algo requires an argument.\n"
                );

                return 1;
            }

            algorithm = find_algorithm(argv[++i]);

            if (!algorithm) {

                fprintf(
                    stderr,
                    "ERROR: Unknown algorithm '%s'.\n",
                    argv[i]
                );

                fprintf(
                    stderr,
                    "Supported algorithms: "
                    "YespowerMwc, YespowerAdvc\n"
                );

                return 1;
            }

            continue;
        }

        if (!strcmp(argv[i], "--threads") ||
            !strcmp(argv[i], "-t")) {

            if (i + 1 >= (unsigned int)argc) {

                fprintf(
                    stderr,
                    "ERROR: --threads requires an argument.\n"
                );

                return 1;
            }

            threads =
                (unsigned int)strtoul(
                    argv[++i],
                    NULL,
                    10
                );

            if (threads == 0) {

                fprintf(
                    stderr,
                    "ERROR: Thread count must be greater than zero.\n"
                );

                return 1;
            }

            continue;
        }

        if (!strcmp(argv[i], "--duration") ||
            !strcmp(argv[i], "-d")) {

            if (i + 1 >= (unsigned int)argc) {

                fprintf(
                    stderr,
                    "ERROR: --duration requires an argument.\n"
                );

                return 1;
            }

            duration =
                (unsigned int)strtoul(
                    argv[++i],
                    NULL,
                    10
                );

            if (duration == 0) {

                fprintf(
                    stderr,
                    "ERROR: Duration must be greater than zero.\n"
                );

                return 1;
            }

            continue;
        }

        if (!strcmp(argv[i], "--output") ||
            !strcmp(argv[i], "-o")) {

            if (i + 1 >= (unsigned int)argc) {

                fprintf(
                    stderr,
                    "ERROR: --output requires an argument.\n"
                );

                return 1;
            }

            output_file = argv[++i];

            continue;
        }

        fprintf(
            stderr,
            "ERROR: Unknown argument '%s'.\n",
            argv[i]
        );

        print_usage(argv[0]);

        return 1;
    }

    /* ------------------------------------------------------------------ */
    /* Defaults                                                            */
    /* ------------------------------------------------------------------ */

    if (!algorithm)
        algorithm = &ALGO_MWC;

    /* ------------------------------------------------------------------ */
    /* Platform information                                                */
    /* ------------------------------------------------------------------ */

    get_cpu_name(
        cpu,
        sizeof(cpu)
    );

    get_timestamp(
        timestamp,
        sizeof(timestamp)
    );

    printf("\n");

    printf(
        "============================================================\n"
    );

    printf(
        " SugarMaker CPU Benchmark\n"
    );

    printf(
        "============================================================\n"
    );

    printf(
        " Algorithm : %s\n",
        algorithm->name
    );

    printf(
        " Version   : %.1f\n",
        algorithm->version * 0.1
    );

    printf(
        " N         : %u\n",
        algorithm->N
    );

    printf(
        " r         : %u\n",
        algorithm->r
    );

    printf(
        " Threads   : %u\n",
        threads
    );

    printf(
        " Duration  : %u seconds\n",
        duration
    );

    printf(
        " CPU       : %s\n",
        cpu
    );

    printf(
        " Arch      : %s\n",
        get_architecture()
    );

    printf(
        " OS        : %s\n",
        get_os_name()
    );

    printf(
        "============================================================\n"
    );

    printf("\n");

    printf(
        "Starting benchmark...\n"
    );

    fflush(stdout);

    /* ------------------------------------------------------------------ */
    /* Allocate benchmark structures                                      */
    /* ------------------------------------------------------------------ */

    memset(
        &context,
        0,
        sizeof(context)
    );

    context.algorithm = algorithm;
    context.thread_count = threads;
    context.duration_seconds = duration;

    context.hash_counts =
        (uint64_t *)calloc(
            threads,
            sizeof(uint64_t)
        );

    if (!context.hash_counts) {

        fprintf(
            stderr,
            "ERROR: Failed to allocate hash counters.\n"
        );

        return 1;
    }

    thread_handles =
        (benchmark_thread_t *)calloc(
            threads,
            sizeof(benchmark_thread_t)
        );

    workers =
        (benchmark_worker_t *)calloc(
            threads,
            sizeof(benchmark_worker_t)
        );

    if (!thread_handles || !workers) {

        fprintf(
            stderr,
            "ERROR: Failed to allocate thread structures.\n"
        );

        free(context.hash_counts);
        free(thread_handles);
        free(workers);

        return 1;
    }

    atomic_init(
        &context.started,
        0
    );

    atomic_init(
        &context.running,
        1
    );

    atomic_init(
        &context.failed,
        0
    );

    /* ------------------------------------------------------------------ */
    /* Create workers                                                      */
    /* ------------------------------------------------------------------ */

    for (i = 0; i < threads; i++) {

        workers[i].context = &context;
        workers[i].thread_id = i;

#ifdef _WIN32

        thread_handles[i] =
            (HANDLE)_beginthreadex(
                NULL,
                0,
                benchmark_worker,
                &workers[i],
                0,
                NULL
            );

        if (!thread_handles[i]) {

            fprintf(
                stderr,
                "ERROR: Failed to create worker thread %u.\n",
                i
            );

            atomic_store(
                &context.running,
                0
            );

            result = 1;
            threads = i;

            break;
        }

#else

        if (pthread_create(
            &thread_handles[i],
            NULL,
            benchmark_worker,
            &workers[i]
        ) != 0) {

            fprintf(
                stderr,
                "ERROR: Failed to create worker thread %u.\n",
                i
            );

            atomic_store(
                &context.running,
                0
            );

            result = 1;
            threads = i;

            break;
        }

#endif
    }

    if (result) {

        for (i = 0; i < threads; i++) {

#ifdef _WIN32

            WaitForSingleObject(
                thread_handles[i],
                INFINITE
            );

            CloseHandle(
                thread_handles[i]
            );

#else

            pthread_join(
                thread_handles[i],
                NULL
            );

#endif
        }

        free(context.hash_counts);
        free(thread_handles);
        free(workers);

        return 1;
    }

    /* ------------------------------------------------------------------ */
    /* Start synchronized benchmark timer                                  */
    /* ------------------------------------------------------------------ */

    context.start_us = time_us();

    context.end_us =
        context.start_us +
        (uint64_t)duration * 1000000ULL;

    atomic_store(
        &context.started,
        1
    );

    /* ------------------------------------------------------------------ */
    /* Wait for benchmark duration                                         */
    /* ------------------------------------------------------------------ */

    while (atomic_load(&context.running)) {

        uint64_t now = time_us();

        if (now >= context.end_us) {

            atomic_store(
                &context.running,
                0
            );

            break;
        }

        sleep_milliseconds(50);
    }

    atomic_store(
        &context.running,
        0
    );

    /* ------------------------------------------------------------------ */
    /* Wait for workers                                                     */
    /* ------------------------------------------------------------------ */

    for (i = 0; i < threads; i++) {

#ifdef _WIN32

        WaitForSingleObject(
            thread_handles[i],
            INFINITE
        );

        CloseHandle(
            thread_handles[i]
        );

#else

        pthread_join(
            thread_handles[i],
            NULL
        );

#endif
    }

    /* ------------------------------------------------------------------ */
    /* Check benchmark status                                               */
    /* ------------------------------------------------------------------ */

    if (atomic_load(&context.failed)) {

        fprintf(
            stderr,
            "\nERROR: yespower calculation failed.\n"
        );

        result = 1;

        goto cleanup;
    }

    /* ------------------------------------------------------------------ */
    /* Calculate result                                                     */
    /* ------------------------------------------------------------------ */

    for (i = 0; i < threads; i++)
        total_hashes += context.hash_counts[i];

    elapsed_us =
        time_us() -
        context.start_us;

    if (elapsed_us == 0)
        elapsed_us = 1;

    hashrate =
        ((double)total_hashes * 1000000.0) /
        (double)elapsed_us;

    per_thread_hashrate =
        hashrate /
        (double)threads;

    /* ------------------------------------------------------------------ */
    /* Output                                                               */
    /* ------------------------------------------------------------------ */

    printf("\n");

    printf(
        "============================================================\n"
    );

    printf(
        " Benchmark Complete\n"
    );

    printf(
        "============================================================\n"
    );

    printf(
        " Algorithm       : %s\n",
        algorithm->name
    );

    printf(
        " Threads         : %u\n",
        threads
    );

    printf(
        " Duration        : %.2f seconds\n",
        (double)elapsed_us / 1000000.0
    );

    printf(
        " Total hashes    : %" PRIu64 "\n",
        total_hashes
    );

    printf(
        " Hashrate        : %.2f H/s\n",
        hashrate
    );

    printf(
        " Per-thread      : %.2f H/s\n",
        per_thread_hashrate
    );

    printf(
        "============================================================\n"
    );

    printf("\n");

    /*
     * Machine-readable result.
     *
     * Keep this as a single line because the GUI can parse it easily.
     */
    printf(
        "BENCHMARK_RESULT "
        "algo=%s "
        "threads=%u "
        "hashrate_hps=%.2f "
        "per_thread_hps=%.2f "
        "duration_seconds=%u\n",
        algorithm->name,
        threads,
        hashrate,
        per_thread_hashrate,
        duration
    );

    /* ------------------------------------------------------------------ */
    /* JSON output                                                          */
    /* ------------------------------------------------------------------ */

    if (write_result_json(
        output_file,
        algorithm,
        cpu,
        get_architecture(),
        get_os_name(),
        threads,
        hashrate,
        per_thread_hashrate,
        duration,
        timestamp
    )) {

        fprintf(
            stderr,
            "WARNING: Benchmark completed but JSON output failed.\n"
        );

        result = 1;

    } else {

        printf(
            "JSON result saved to: %s\n",
            output_file
        );
    }

cleanup:

    free(context.hash_counts);
    free(thread_handles);
    free(workers);

    return result;
}
