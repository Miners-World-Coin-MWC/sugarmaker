/*-
 * Sugarmaker CPU Benchmark
 *
 * Benchmark support for:
 *   - YespowerMwc
 *   - YespowerAdvc
 *
 * The benchmark produces:
 *
 *   1. Human-readable console output
 *   2. A machine-readable BENCHMARK_RESULT line
 *   3. A user-specific JSON result file
 *
 * The generated JSON can be submitted to the project and added to:
 *
 *   benchmarks/benchmark.json
 *
 * No database is required.
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include <errno.h>
#include <stdatomic.h>

#include "yespower.h"

#ifdef _WIN32

#include <windows.h>
#include <process.h>

#define THREAD_RETURN unsigned __stdcall
#define THREAD_CALL __stdcall

#else

#include <pthread.h>
#include <unistd.h>
#include <sys/time.h>

#define THREAD_RETURN void *
#define THREAD_CALL

#endif


/* ============================================================================
 * CONFIGURATION
 * ========================================================================== */

#define DEFAULT_THREADS 1
#define DEFAULT_DURATION 30

#define BENCHMARK_RESULT_FILE "benchmark-result.json"

#define MWC_PERS \
    "Mining made easy and accessible to all - Miners World Coin 2025"

#define ADVC_PERS \
    "Let the quest begin"


/* ============================================================================
 * TYPES
 * ========================================================================== */

typedef struct {
    const char *name;
    yespower_version_t version;
    uint32_t N;
    uint32_t r;
    const uint8_t *pers;
    size_t perslen;
} benchmark_algorithm_t;


typedef struct {
    unsigned int thread_id;

    uint64_t hashes;

    int failed;

    uint8_t src[80];

#ifdef _WIN32
    HANDLE thread;
#else
    pthread_t thread;
#endif

} benchmark_thread_t;


typedef struct {
    benchmark_thread_t *worker;
    struct benchmark_context *context;
} worker_argument_t;


typedef struct benchmark_context {
    const benchmark_algorithm_t *algorithm;

    unsigned int threads;

    unsigned int duration_seconds;

    _Atomic int running;

    _Atomic int failed;

    benchmark_thread_t *workers;

    uint64_t start_time_us;

    uint64_t end_time_us;

} benchmark_context_t;


/* ============================================================================
 * TIME
 * ========================================================================== */

static uint64_t current_time_us(void)
{
#ifdef _WIN32

    FILETIME ft;
    ULARGE_INTEGER value;

    GetSystemTimeAsFileTime(&ft);

    value.LowPart = ft.dwLowDateTime;
    value.HighPart = ft.dwHighDateTime;

    /*
     * FILETIME is measured in 100-nanosecond intervals since
     * January 1, 1601.
     *
     * Only differences are used for benchmark timing, so the epoch
     * itself does not matter here.
     */
    return (uint64_t)(value.QuadPart / 10ULL);

#else

    struct timeval tv;

    if (gettimeofday(&tv, NULL) != 0)
        return 0;

    return
        (uint64_t)tv.tv_sec * 1000000ULL +
        (uint64_t)tv.tv_usec;

#endif
}


/* ============================================================================
 * CPU / SYSTEM INFORMATION
 * ========================================================================== */

static void get_architecture(
    char *buffer,
    size_t size
)
{
#if defined(__x86_64__) || defined(_M_X64)

    snprintf(buffer, size, "x86_64");

#elif defined(__i386__) || defined(_M_IX86)

    snprintf(buffer, size, "i686");

#elif defined(__aarch64__) || defined(_M_ARM64)

    snprintf(buffer, size, "aarch64");

#elif defined(__arm__) || defined(_M_ARM)

    snprintf(buffer, size, "armv7l");

#elif defined(__riscv) && (__riscv_xlen == 64)

    snprintf(buffer, size, "riscv64");

#elif defined(__riscv) && (__riscv_xlen == 32)

    snprintf(buffer, size, "riscv32");

#else

    snprintf(buffer, size, "unknown");

#endif
}


static void get_os_name(
    char *buffer,
    size_t size
)
{
#ifdef _WIN32

    snprintf(buffer, size, "Windows");

#elif defined(__APPLE__)

    snprintf(buffer, size, "macOS");

#elif defined(__linux__)

    snprintf(buffer, size, "Linux");

#elif defined(__FreeBSD__)

    snprintf(buffer, size, "FreeBSD");

#else

    snprintf(buffer, size, "Unknown");

#endif
}


static void get_cpu_name(
    char *buffer,
    size_t size
)
{
    buffer[0] = '\0';


#ifdef _WIN32

    {
        const char *cpu =
            getenv("PROCESSOR_IDENTIFIER");

        if (cpu && cpu[0])
        {
            snprintf(
                buffer,
                size,
                "%s",
                cpu
            );

            return;
        }
    }

#endif


#if defined(__APPLE__)

    {
        FILE *pipe;

        char line[512];

        pipe = popen(
            "sysctl -n machdep.cpu.brand_string 2>/dev/null",
            "r"
        );

        if (pipe)
        {
            if (fgets(
                    line,
                    sizeof(line),
                    pipe
                ))
            {
                line[strcspn(
                    line,
                    "\r\n"
                )] = '\0';

                if (line[0])
                {
                    snprintf(
                        buffer,
                        size,
                        "%s",
                        line
                    );

                    pclose(pipe);

                    return;
                }
            }

            pclose(pipe);
        }
    }

#endif


#if defined(__linux__)

    {
        FILE *file;

        char line[512];

        file = fopen(
            "/proc/cpuinfo",
            "r"
        );

        if (file)
        {
            while (fgets(
                       line,
                       sizeof(line),
                       file
                   ))
            {
                if (
                    strncmp(
                        line,
                        "model name",
                        10
                    ) == 0 ||
                    strncmp(
                        line,
                        "Hardware",
                        8
                    ) == 0 ||
                    strncmp(
                        line,
                        "Model",
                        5
                    ) == 0
                )
                {
                    char *colon =
                        strchr(
                            line,
                            ':'
                        );

                    if (colon)
                    {
                        char *name =
                            colon + 1;

                        while (
                            *name == ' ' ||
                            *name == '\t'
                        )
                        {
                            name++;
                        }

                        name[strcspn(
                            name,
                            "\r\n"
                        )] = '\0';

                        if (name[0])
                        {
                            snprintf(
                                buffer,
                                size,
                                "%s",
                                name
                            );

                            fclose(file);

                            return;
                        }
                    }
                }
            }

            fclose(file);
        }
    }

#endif


    snprintf(
        buffer,
        size,
        "Unknown CPU"
    );
}


/* ============================================================================
 * THREAD COUNT
 * ========================================================================== */

static unsigned int get_default_thread_count(void)
{
#ifdef _WIN32

    SYSTEM_INFO info;

    GetSystemInfo(&info);

    if (info.dwNumberOfProcessors > 0)
    {
        return (unsigned int)
            info.dwNumberOfProcessors;
    }

#elif defined(_SC_NPROCESSORS_ONLN)

    long processors =
        sysconf(
            _SC_NPROCESSORS_ONLN
        );

    if (processors > 0)
    {
        return (unsigned int)processors;
    }

#endif

    return DEFAULT_THREADS;
}


/* ============================================================================
 * ALGORITHM DEFINITIONS
 * ========================================================================== */

static const benchmark_algorithm_t ALGORITHM_MWC = {
    "YespowerMwc",
    YESPOWER_1_0,
    2048,
    32,
    (const uint8_t *)MWC_PERS,
    sizeof(MWC_PERS) - 1
};


static const benchmark_algorithm_t ALGORITHM_ADVC = {
    "YespowerAdvc",
    YESPOWER_1_0,
    2048,
    32,
    (const uint8_t *)ADVC_PERS,
    sizeof(ADVC_PERS) - 1
};


static const benchmark_algorithm_t *get_algorithm(
    const char *name
)
{
    if (!name)
        return NULL;


    if (
        strcmp(
            name,
            "YespowerMwc"
        ) == 0 ||
        strcmp(
            name,
            "mwc"
        ) == 0 ||
        strcmp(
            name,
            "MWC"
        ) == 0
    )
    {
        return &ALGORITHM_MWC;
    }


    if (
        strcmp(
            name,
            "YespowerAdvc"
        ) == 0 ||
        strcmp(
            name,
            "advc"
        ) == 0 ||
        strcmp(
            name,
            "ADVC"
        ) == 0
    )
    {
        return &ALGORITHM_ADVC;
    }


    return NULL;
}


/* ============================================================================
 * WORKER
 * ========================================================================== */

static THREAD_RETURN THREAD_CALL benchmark_worker(
    void *argument
)
{
    worker_argument_t *worker_argument =
        (worker_argument_t *)argument;

    benchmark_context_t *context =
        worker_argument->context;

    benchmark_thread_t *worker =
        worker_argument->worker;

    yespower_params_t params;

    yespower_binary_t dst;

    uint32_t counter = 0;


    params.version =
        context->algorithm->version;

    params.N =
        context->algorithm->N;

    params.r =
        context->algorithm->r;

    params.pers =
        context->algorithm->pers;

    params.perslen =
        context->algorithm->perslen;


    /*
     * Give every worker its own deterministic input.
     *
     * The last four bytes act as a changing nonce.
     */
    memset(
        worker->src,
        0,
        sizeof(worker->src)
    );


    for (
        unsigned int i = 0;
        i < sizeof(worker->src);
        i++
    )
    {
        worker->src[i] =
            (uint8_t)(
                (i * 3) ^
                (worker->thread_id * 17)
            );
    }


    /*
     * Start every worker with a different nonce.
     */
    counter =
        worker->thread_id;


    while (
        atomic_load_explicit(
            &context->running,
            memory_order_relaxed
        )
    )
    {
        worker->src[76] =
            (uint8_t)(
                counter & 0xff
            );

        worker->src[77] =
            (uint8_t)(
                (counter >> 8) & 0xff
            );

        worker->src[78] =
            (uint8_t)(
                (counter >> 16) & 0xff
            );

        worker->src[79] =
            (uint8_t)(
                (counter >> 24) & 0xff
            );


        if (
            yespower_tls(
                worker->src,
                sizeof(worker->src),
                &params,
                &dst
            ) != 0
        )
        {
            worker->failed = 1;

            atomic_store_explicit(
                &context->failed,
                1,
                memory_order_relaxed
            );

            atomic_store_explicit(
                &context->running,
                0,
                memory_order_relaxed
            );

            break;
        }


        worker->hashes++;

        counter++;
    }


#ifdef _WIN32

    return 0;

#else

    return NULL;

#endif
}


/* ============================================================================
 * THREAD CREATION
 * ========================================================================== */

static int start_worker(
    benchmark_thread_t *worker,
    worker_argument_t *argument
)
{
#ifdef _WIN32

    worker->thread =
        (HANDLE)_beginthreadex(
            NULL,
            0,
            benchmark_worker,
            argument,
            0,
            NULL
        );

    return
        worker->thread != NULL
            ? 0
            : -1;

#else

    return pthread_create(
        &worker->thread,
        NULL,
        benchmark_worker,
        argument
    );

#endif
}


static void join_worker(
    benchmark_thread_t *worker
)
{
#ifdef _WIN32

    WaitForSingleObject(
        worker->thread,
        INFINITE
    );

    CloseHandle(
        worker->thread
    );

#else

    pthread_join(
        worker->thread,
        NULL
    );

#endif
}


/* ============================================================================
 * JSON ESCAPING
 * ========================================================================== */

static void json_write_string(
    FILE *file,
    const char *value
)
{
    const unsigned char *p =
        (const unsigned char *)value;


    fputc(
        '"',
        file
    );


    while (*p)
    {
        switch (*p)
        {
            case '\\':

                fputs(
                    "\\\\",
                    file
                );

                break;


            case '"':

                fputs(
                    "\\\"",
                    file
                );

                break;


            case '\n':

                fputs(
                    "\\n",
                    file
                );

                break;


            case '\r':

                fputs(
                    "\\r",
                    file
                );

                break;


            case '\t':

                fputs(
                    "\\t",
                    file
                );

                break;


            default:

                fputc(
                    *p,
                    file
                );

                break;
        }

        p++;
    }


    fputc(
        '"',
        file
    );
}


/* ============================================================================
 * TIMESTAMP
 * ========================================================================== */

static void get_timestamp(
    char *buffer,
    size_t size
)
{
    time_t now =
        time(NULL);

    struct tm tm_value;


#ifdef _WIN32

    if (
        gmtime_s(
            &tm_value,
            &now
        ) != 0
    )
    {
        snprintf(
            buffer,
            size,
            "unknown"
        );

        return;
    }

#else

    if (
        gmtime_r(
            &now,
            &tm_value
        ) == NULL
    )
    {
        snprintf(
            buffer,
            size,
            "unknown"
        );

        return;
    }

#endif


    strftime(
        buffer,
        size,
        "%Y-%m-%dT%H:%M:%SZ",
        &tm_value
    );
}


/* ============================================================================
 * VERSION
 * ========================================================================== */

static const char *get_sugarmaker_version(void)
{
    /*
     * Keep this in one place so it can be updated whenever
     * the miner version changes.
     */
    return "1.0.0";
}


/* ============================================================================
 * JSON OUTPUT
 * ========================================================================== */

static int write_user_json(
    const char *filename,
    const benchmark_context_t *context,
    double hashrate_hps,
    double per_thread_hps,
    const char *cpu,
    const char *architecture,
    const char *os,
    const char *timestamp
)
{
    FILE *file;


    file =
        fopen(
            filename,
            "w"
        );


    if (!file)
    {
        fprintf(
            stderr,
            "Failed to create %s: %s\n",
            filename,
            strerror(errno)
        );

        return -1;
    }


    fprintf(
        file,
        "{\n"
        "  \"schema_version\": 1,\n"
        "  \"benchmark\": {\n"
    );


    fprintf(
        file,
        "    \"algorithm\": "
    );

    json_write_string(
        file,
        context->algorithm->name
    );

    fprintf(
        file,
        ",\n"
    );


    fprintf(
        file,
        "    \"cpu\": "
    );

    json_write_string(
        file,
        cpu
    );

    fprintf(
        file,
        ",\n"
    );


    fprintf(
        file,
        "    \"architecture\": "
    );

    json_write_string(
        file,
        architecture
    );

    fprintf(
        file,
        ",\n"
    );


    fprintf(
        file,
        "    \"os\": "
    );

    json_write_string(
        file,
        os
    );

    fprintf(
        file,
        ",\n"
    );


    fprintf(
        file,
        "    \"threads\": %u,\n",
        context->threads
    );


    fprintf(
        file,
        "    \"hashrate_hps\": %.6f,\n",
        hashrate_hps
    );


    fprintf(
        file,
        "    \"per_thread_hps\": %.6f,\n",
        per_thread_hps
    );


    fprintf(
        file,
        "    \"duration_seconds\": %u,\n",
        context->duration_seconds
    );


    fprintf(
        file,
        "    \"sugarmaker_version\": "
    );

    json_write_string(
        file,
        get_sugarmaker_version()
    );

    fprintf(
        file,
        ",\n"
    );


    fprintf(
        file,
        "    \"timestamp\": "
    );

    json_write_string(
        file,
        timestamp
    );


    fprintf(
        file,
        "\n"
        "  }\n"
        "}\n"
    );


    if (
        fclose(file) != 0
    )
    {
        fprintf(
            stderr,
            "Failed to finalize %s.\n",
            filename
        );

        return -1;
    }


    return 0;
}


/* ============================================================================
 * BENCHMARK
 * ========================================================================== */

static int run_benchmark(
    const benchmark_algorithm_t *algorithm,
    unsigned int threads,
    unsigned int duration_seconds,
    const char *output_filename
)
{
    benchmark_context_t context;

    worker_argument_t *arguments;

    uint64_t total_hashes = 0;

    uint64_t start_time;

    uint64_t end_time;

    uint64_t deadline;

    double elapsed_seconds;

    double hashrate_hps;

    double per_thread_hps;

    char cpu[512];

    char architecture[64];

    char os[64];

    char timestamp[64];

    unsigned int i;


    memset(
        &context,
        0,
        sizeof(context)
    );


    context.algorithm =
        algorithm;

    context.threads =
        threads;

    context.duration_seconds =
        duration_seconds;


    atomic_init(
        &context.running,
        1
    );

    atomic_init(
        &context.failed,
        0
    );


    context.workers =
        calloc(
            threads,
            sizeof(benchmark_thread_t)
        );


    if (!context.workers)
    {
        fprintf(
            stderr,
            "Failed to allocate benchmark workers.\n"
        );

        return 1;
    }


    arguments =
        calloc(
            threads,
            sizeof(worker_argument_t)
        );


    if (!arguments)
    {
        fprintf(
            stderr,
            "Failed to allocate worker arguments.\n"
        );

        free(
            context.workers
        );

        return 1;
    }


    printf("\n");
    printf("============================================================\n");
    printf("Sugarmaker CPU Benchmark\n");
    printf("============================================================\n");
    printf(
        "Algorithm : %s\n",
        algorithm->name
    );
    printf(
        "Yespower  : %.1f\n",
        algorithm->version * 0.1
    );
    printf(
        "N         : %u\n",
        algorithm->N
    );
    printf(
        "r         : %u\n",
        algorithm->r
    );
    printf(
        "Threads   : %u\n",
        threads
    );
    printf(
        "Duration  : %u seconds\n",
        duration_seconds
    );
    printf("============================================================\n");
    printf("\n");


    /*
     * Start timing BEFORE workers are created.
     */
    start_time =
        current_time_us();


    if (start_time == 0)
    {
        fprintf(
            stderr,
            "Failed to obtain benchmark start time.\n"
        );

        free(arguments);
        free(context.workers);

        return 1;
    }


    context.start_time_us =
        start_time;


    /*
     * Calculate the exact benchmark deadline.
     */
    deadline =
        start_time +
        ((uint64_t)duration_seconds * 1000000ULL);


    /*
     * Create workers.
     */
    for (
        i = 0;
        i < threads;
        i++
    )
    {
        context.workers[i].thread_id =
            i;

        context.workers[i].hashes =
            0;

        context.workers[i].failed =
            0;


        arguments[i].context =
            &context;

        arguments[i].worker =
            &context.workers[i];


        if (
            start_worker(
                &context.workers[i],
                &arguments[i]
            ) != 0
        )
        {
            fprintf(
                stderr,
                "Failed to create benchmark thread %u.\n",
                i
            );


            atomic_store_explicit(
                &context.running,
                0,
                memory_order_relaxed
            );


            for (
                unsigned int j = 0;
                j < i;
                j++
            )
            {
                join_worker(
                    &context.workers[j]
                );
            }


            free(arguments);
            free(context.workers);

            return 1;
        }
    }


    printf(
        "Benchmark running for %u seconds...\n",
        duration_seconds
    );


    /*
     * Display progress while the workers perform hashes.
     */
    for (
        unsigned int second = 0;
        second < duration_seconds;
        second++
    )
    {
        uint64_t now;

        unsigned int remaining_ms =
            1000;


        while (remaining_ms > 0)
        {
            now =
                current_time_us();


            if (
                now >= deadline ||
                !atomic_load_explicit(
                    &context.running,
                    memory_order_relaxed
                )
            )
            {
                remaining_ms = 0;
                break;
            }


            sleep_milliseconds(100);


            if (remaining_ms >= 100)
                remaining_ms -= 100;
            else
                remaining_ms = 0;
        }


        if (
            !atomic_load_explicit(
                &context.running,
                memory_order_relaxed
            )
        )
        {
            break;
        }


        printf(
            "\rElapsed: %u/%u seconds",
            second + 1,
            duration_seconds
        );

        fflush(stdout);
    }


    /*
     * Stop all workers.
     */
    atomic_store_explicit(
        &context.running,
        0,
        memory_order_relaxed
    );


    printf("\n");


    /*
     * Wait for all workers.
     */
    for (
        i = 0;
        i < threads;
        i++
    )
    {
        join_worker(
            &context.workers[i]
        );
    }


    end_time =
        current_time_us();


    context.end_time_us =
        end_time;


    if (
        atomic_load_explicit(
            &context.failed,
            memory_order_relaxed
        )
    )
    {
        fprintf(
            stderr,
            "Benchmark failed because a worker encountered an error.\n"
        );

        free(arguments);
        free(context.workers);

        return 1;
    }


    /*
     * Count total hashes.
     */
    for (
        i = 0;
        i < threads;
        i++
    )
    {
        total_hashes +=
            context.workers[i].hashes;
    }


    if (
        end_time <= start_time
    )
    {
        fprintf(
            stderr,
            "Invalid benchmark timing.\n"
        );

        free(arguments);
        free(context.workers);

        return 1;
    }


    elapsed_seconds =
        (double)(
            end_time - start_time
        ) / 1000000.0;


    hashrate_hps =
        (double)total_hashes /
        elapsed_seconds;


    per_thread_hps =
        hashrate_hps /
        (double)threads;


    get_cpu_name(
        cpu,
        sizeof(cpu)
    );


    get_architecture(
        architecture,
        sizeof(architecture)
    );


    get_os_name(
        os,
        sizeof(os)
    );


    get_timestamp(
        timestamp,
        sizeof(timestamp)
    );


    printf("\n");
    printf("============================================================\n");
    printf("Benchmark Complete\n");
    printf("============================================================\n");


    printf(
        "CPU       : %s\n",
        cpu
    );


    printf(
        "OS        : %s\n",
        os
    );


    printf(
        "Arch      : %s\n",
        architecture
    );


    printf(
        "Threads   : %u\n",
        threads
    );


    printf(
        "Hashes    : %llu\n",
        (unsigned long long)total_hashes
    );


    printf(
        "Time      : %.3f seconds\n",
        elapsed_seconds
    );


    printf(
        "Hashrate  : %.3f H/s\n",
        hashrate_hps
    );


    printf(
        "Per Thread: %.3f H/s\n",
        per_thread_hps
    );


    printf(
        "============================================================\n"
    );


    /*
     * Machine-readable output for the Tauri Agent.
     */
    printf(
        "\n"
        "BENCHMARK_RESULT "
        "algo=%s "
        "threads=%u "
        "hashrate_hps=%.6f "
        "per_thread_hps=%.6f "
        "duration_seconds=%u\n",
        algorithm->name,
        threads,
        hashrate_hps,
        per_thread_hps,
        duration_seconds
    );


    /*
     * Create the user's JSON result.
     */
    if (
        write_user_json(
            output_filename,
            &context,
            hashrate_hps,
            per_thread_hps,
            cpu,
            architecture,
            os,
            timestamp
        ) != 0
    )
    {
        fprintf(
            stderr,
            "Warning: benchmark completed but JSON could not be written.\n"
        );
    }
    else
    {
        printf(
            "\nUser benchmark result saved to:\n"
            "  %s\n",
            output_filename
        );
    }


    free(arguments);

    free(context.workers);

    return 0;
}


/* ============================================================================
 * SLEEP
 * ========================================================================== */

static void sleep_milliseconds(
    unsigned int milliseconds
);


/* ============================================================================
 * HELP
 * ========================================================================== */

static void print_help(
    const char *program
)
{
    printf(
        "\n"
        "Sugarmaker CPU Benchmark\n"
        "\n"
        "Usage:\n"
        "  %s --algo <algorithm> --threads <threads> "
        "--duration <seconds> [--output <file>]\n"
        "\n"
        "Algorithms:\n"
        "  YespowerMwc\n"
        "  YespowerAdvc\n"
        "\n"
        "Options:\n"
        "  --algo       Algorithm to benchmark\n"
        "  --threads    Number of CPU threads\n"
        "  --duration   Benchmark duration in seconds\n"
        "  --output     Output JSON filename\n"
        "  --help       Show this help message\n"
        "\n"
        "Examples:\n"
        "  %s --algo YespowerMwc --threads 4 --duration 30\n"
        "  %s --algo YespowerAdvc --threads 8 --duration 60\n"
        "  %s --algo YespowerMwc --threads 16 --duration 60 "
        "--output my-benchmark.json\n"
        "\n",
        program,
        program,
        program,
        program
    );
}


/* ============================================================================
 * MAIN
 * ========================================================================== */

int main(
    int argc,
    char **argv
)
{
    const char *algorithm_name =
        NULL;

    const char *output_filename =
        BENCHMARK_RESULT_FILE;

    unsigned int threads =
        get_default_thread_count();

    unsigned int duration_seconds =
        DEFAULT_DURATION;

    const benchmark_algorithm_t *algorithm;


    /*
     * Parse command line.
     */
    for (
        int i = 1;
        i < argc;
        i++
    )
    {
        /*
         * Help.
         */
        if (
            strcmp(
                argv[i],
                "--help"
            ) == 0 ||
            strcmp(
                argv[i],
                "-h"
            ) == 0
        )
        {
            print_help(
                argv[0]
            );

            return 0;
        }


        /*
         * Algorithm.
         */
        if (
            strcmp(
                argv[i],
                "--algo"
            ) == 0
        )
        {
            if (
                i + 1 >= argc
            )
            {
                fprintf(
                    stderr,
                    "--algo requires a value.\n"
                );

                return 1;
            }


            algorithm_name =
                argv[++i];

            continue;
        }


        /*
         * Threads.
         */
        if (
            strcmp(
                argv[i],
                "--threads"
            ) == 0
        )
        {
            long value;


            if (
                i + 1 >= argc
            )
            {
                fprintf(
                    stderr,
                    "--threads requires a value.\n"
                );

                return 1;
            }


            value =
                strtol(
                    argv[++i],
                    NULL,
                    10
                );


            if (
                value < 1 ||
                value > 4096
            )
            {
                fprintf(
                    stderr,
                    "Invalid thread count.\n"
                );

                return 1;
            }


            threads =
                (unsigned int)value;

            continue;
        }


        /*
         * Duration.
         */
        if (
            strcmp(
                argv[i],
                "--duration"
            ) == 0
        )
        {
            long value;


            if (
                i + 1 >= argc
            )
            {
                fprintf(
                    stderr,
                    "--duration requires a value.\n"
                );

                return 1;
            }


            value =
                strtol(
                    argv[++i],
                    NULL,
                    10
                );


            if (
                value < 1 ||
                value > 86400
            )
            {
                fprintf(
                    stderr,
                    "Invalid benchmark duration.\n"
                );

                return 1;
            }


            duration_seconds =
                (unsigned int)value;

            continue;
        }


        /*
         * Output filename.
         */
        if (
            strcmp(
                argv[i],
                "--output"
            ) == 0
        )
        {
            if (
                i + 1 >= argc
            )
            {
                fprintf(
                    stderr,
                    "--output requires a filename.\n"
                );

                return 1;
            }


            output_filename =
                argv[++i];

            continue;
        }


        /*
         * Unknown argument.
         */
        fprintf(
            stderr,
            "Unknown argument: %s\n",
            argv[i]
        );


        print_help(
            argv[0]
        );


        return 1;
    }


    /*
     * Default algorithm.
     */
    if (!algorithm_name)
        algorithm_name =
            "YespowerMwc";


    algorithm =
        get_algorithm(
            algorithm_name
        );


    if (!algorithm)
    {
        fprintf(
            stderr,
            "Unknown algorithm: %s\n",
            algorithm_name
        );

        fprintf(
            stderr,
            "Supported algorithms:\n"
            "  YespowerMwc\n"
            "  YespowerAdvc\n"
        );

        return 1;
    }


    if (
        !output_filename ||
        !output_filename[0]
    )
    {
        output_filename =
            BENCHMARK_RESULT_FILE;
    }


    return run_benchmark(
        algorithm,
        threads,
        duration_seconds,
        output_filename
    );
}


/* ============================================================================
 * SLEEP IMPLEMENTATION
 * ========================================================================== */

static void sleep_milliseconds(
    unsigned int milliseconds
)
{
#ifdef _WIN32

    Sleep(
        milliseconds
    );

#else

    struct timespec request;

    request.tv_sec =
        milliseconds / 1000;

    request.tv_nsec =
        (long)(
            milliseconds % 1000
        ) * 1000000L;


    while (
        nanosleep(
            &request,
            &request
        ) != 0
    )
    {
        if (
            errno != EINTR
        )
        {
            break;
        }
    }

#endif
}