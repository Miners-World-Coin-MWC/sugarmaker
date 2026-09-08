/*-
 * Copyright 2013-2018 Alexander Peslyak
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */

/*
 * Sugarmaker CPU Benchmark
 *
 * This benchmark intentionally uses the exact Yespower parameters used by
 * the Sugarmaker MWC and ADVC mining implementations.
 *
 * YespowerMwc:
 *   version = YESPOWER_1_0
 *   N       = 2048
 *   r       = 32
 *   pers    = "Mining made easy and accessible to all - Miners World Coin 2025"
 *
 * YespowerAdvc:
 *   version = YESPOWER_1_0
 *   N       = 2048
 *   r       = 32
 *   pers    = "Let the quest begin"
 *
 * The benchmark does not perform target checking because the purpose here
 * is to measure raw Yespower throughput. Each hash uses an 80-byte block
 * and a changing nonce, matching the computational workload performed by
 * the actual mining algorithms.
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <inttypes.h>
#include <string.h>
#include <errno.h>
#include <limits.h>

#ifdef _WIN32
#include <windows.h>
#else
#include <time.h>
#include <unistd.h>
#endif

#include <pthread.h>

#include "yespower.h"


/* ------------------------------------------------------------------------- */
/* Configuration                                                             */
/* ------------------------------------------------------------------------- */

#define DEFAULT_THREADS 1
#define DEFAULT_DURATION 30

#define MIN_THREADS 1
#define MIN_DURATION 1

#define START_DELAY_NS 100000000ULL /* 100 ms */


/* ------------------------------------------------------------------------- */
/* Algorithm definitions                                                     */
/* ------------------------------------------------------------------------- */

typedef struct {
	const char *name;
	yespower_params_t params;
} benchmark_algorithm_t;


/*
 * These parameters MUST remain identical to the corresponding mining
 * implementations:
 *
 * src/YespowerMwc.c
 * src/YespowerAdvc.c
 */
static const benchmark_algorithm_t ALGORITHMS[] = {
	{
		.name = "YespowerMwc",
		.params = {
			.version = YESPOWER_1_0,
			.N = 2048,
			.r = 32,
			.pers = (const uint8_t *)
				"Mining made easy and accessible to all - Miners World Coin 2025",
			.perslen = 63
		}
	},
	{
		.name = "YespowerAdvc",
		.params = {
			.version = YESPOWER_1_0,
			.N = 2048,
			.r = 32,
			.pers = (const uint8_t *)"Let the quest begin",
			.perslen = 19
		}
	}
};

#define ALGORITHM_COUNT \
	(sizeof(ALGORITHMS) / sizeof(ALGORITHMS[0]))


/* ------------------------------------------------------------------------- */
/* Timing                                                                    */
/* ------------------------------------------------------------------------- */

static uint64_t time_ns(void)
{
#ifdef _WIN32
	LARGE_INTEGER frequency;
	LARGE_INTEGER counter;

	if (!QueryPerformanceFrequency(&frequency))
		return 0;

	if (!QueryPerformanceCounter(&counter))
		return 0;

	return (uint64_t)(
		((long double)counter.QuadPart * 1000000000.0L) /
		(long double)frequency.QuadPart
	);
#else
	struct timespec ts;

#ifdef CLOCK_MONOTONIC_RAW
	if (clock_gettime(CLOCK_MONOTONIC_RAW, &ts))
		return 0;
#else
	if (clock_gettime(CLOCK_MONOTONIC, &ts))
		return 0;
#endif

	return (uint64_t)ts.tv_sec * 1000000000ULL +
		(uint64_t)ts.tv_nsec;
#endif
}


/* ------------------------------------------------------------------------- */
/* Deterministic benchmark input                                             */
/* ------------------------------------------------------------------------- */

static void build_header(uint8_t header[80], uint32_t nonce)
{
	unsigned int i;

	/*
	 * Deterministic 80-byte block.
	 *
	 * The actual miner hashes an 80-byte block header. For benchmarking we
	 * only need a deterministic block with a changing nonce so every call
	 * represents a distinct mining attempt.
	 */
	for (i = 0; i < 80; i++)
		header[i] = (uint8_t)((i * 37U + 11U) & 0xffU);

	/*
	 * The miner writes the nonce as a big-endian uint32_t into the final
	 * four bytes of the 80-byte block.
	 */
	header[76] = (uint8_t)(nonce >> 24);
	header[77] = (uint8_t)(nonce >> 16);
	header[78] = (uint8_t)(nonce >> 8);
	header[79] = (uint8_t)nonce;
}


/* ------------------------------------------------------------------------- */
/* Thread state                                                               */
/* ------------------------------------------------------------------------- */

typedef struct {
	const benchmark_algorithm_t *algorithm;

	unsigned int thread_id;

	uint64_t start_ns;
	uint64_t end_ns;

	uint64_t hashes;
	uint64_t checksum;

	int failed;
} benchmark_thread_t;


/*
 * Prevent the compiler from treating the resulting hash as completely
 * unused. This is not used for measuring performance.
 */
static volatile uint64_t benchmark_sink = 0;


/* ------------------------------------------------------------------------- */
/* Benchmark worker                                                           */
/* ------------------------------------------------------------------------- */

static void *benchmark_thread(void *arg)
{
	benchmark_thread_t *thread =
		(benchmark_thread_t *)arg;

	uint8_t header[80];
	yespower_binary_t hash;

	uint32_t nonce =
		0x10000000U +
		(thread->thread_id * 0x01000000U);

	uint64_t hashes = 0;
	uint64_t checksum = 0;

	/*
	 * Keep the input unique per thread.
	 */
	build_header(header, nonce);

	/*
	 * Wait until the common start time.
	 *
	 * This avoids one thread starting substantially earlier than another
	 * simply because pthread_create() is sequential.
	 */
	while (time_ns() < thread->start_ns) {
		/* busy wait intentionally; this period is only 100 ms */
	}

	while (time_ns() < thread->end_ns) {
		if (yespower_tls(
			header,
			sizeof(header),
			&thread->algorithm->params,
			&hash
		)) {
			thread->failed = 1;
			break;
		}

		/*
		 * Consume a few output bytes so the result cannot be discarded
		 * by aggressive compiler optimization.
		 */
		checksum ^= (uint64_t)hash.uc[0];
		checksum ^= (uint64_t)hash.uc[7] << 8;
		checksum ^= (uint64_t)hash.uc[15] << 16;
		checksum ^= (uint64_t)hash.uc[23] << 24;

		hashes++;

		nonce++;

		header[76] = (uint8_t)(nonce >> 24);
		header[77] = (uint8_t)(nonce >> 16);
		header[78] = (uint8_t)(nonce >> 8);
		header[79] = (uint8_t)nonce;
	}

	thread->hashes = hashes;
	thread->checksum = checksum;

	benchmark_sink ^= checksum;

	return NULL;
}


/* ------------------------------------------------------------------------- */
/* Algorithm lookup                                                           */
/* ------------------------------------------------------------------------- */

static const benchmark_algorithm_t *find_algorithm(
	const char *name)
{
	size_t i;

	if (!name)
		return NULL;

	for (i = 0; i < ALGORITHM_COUNT; i++) {
		if (!strcmp(name, ALGORITHMS[i].name))
			return &ALGORITHMS[i];
	}

	return NULL;
}


/* ------------------------------------------------------------------------- */
/* Numeric argument parsing                                                   */
/* ------------------------------------------------------------------------- */

static int parse_uint(
	const char *value,
	unsigned int *result)
{
	char *end;
	unsigned long parsed;

	if (!value || !*value)
		return 0;

	errno = 0;

	parsed = strtoul(value, &end, 10);

	if (errno ||
	    end == value ||
	    *end != '\0' ||
	    parsed > UINT_MAX)
		return 0;

	*result = (unsigned int)parsed;

	return 1;
}


static int parse_uint64(
	const char *value,
	uint64_t *result)
{
	char *end;
	unsigned long long parsed;

	if (!value || !*value)
		return 0;

	errno = 0;

	parsed = strtoull(value, &end, 10);

	if (errno ||
	    end == value ||
	    *end != '\0')
		return 0;

	*result = (uint64_t)parsed;

	return 1;
}


/* ------------------------------------------------------------------------- */
/* Help                                                                       */
/* ------------------------------------------------------------------------- */

static void print_usage(const char *program)
{
	printf(
		"Sugarmaker CPU Benchmark\n"
		"\n"
		"Usage:\n"
		"  %s --algo <algorithm> --threads <threads> "
		"--duration <seconds> [--machine]\n"
		"\n"
		"Algorithms:\n"
		"  YespowerMwc\n"
		"  YespowerAdvc\n"
		"\n"
		"Options:\n"
		"  --algo <name>       Algorithm to benchmark\n"
		"  --threads <count>   Number of CPU threads\n"
		"  --duration <sec>    Benchmark duration in seconds\n"
		"  --machine           Output machine-readable result\n"
		"  --help              Show this help\n"
		"\n"
		"Defaults:\n"
		"  threads  = %u\n"
		"  duration = %u seconds\n"
		"\n",
		program,
		DEFAULT_THREADS,
		DEFAULT_DURATION
	);
}


/* ------------------------------------------------------------------------- */
/* Main benchmark                                                             */
/* ------------------------------------------------------------------------- */

int main(int argc, char **argv)
{
	const benchmark_algorithm_t *algorithm = NULL;

	unsigned int threads = DEFAULT_THREADS;
	uint64_t duration_seconds = DEFAULT_DURATION;

	int machine_output = 0;

	unsigned int i;

	pthread_t *thread_handles = NULL;
	benchmark_thread_t *thread_data = NULL;

	uint64_t start_ns;
	uint64_t end_ns;
	uint64_t actual_start_ns;
	uint64_t actual_end_ns;

	uint64_t total_hashes = 0;
	uint64_t total_checksum = 0;

	double elapsed_seconds;
	double hashrate_hps;
	double per_thread_hps;

	int exit_code = 0;


	/* ------------------------------------------------------------------ */
	/* Parse command line                                                  */
	/* ------------------------------------------------------------------ */

	for (i = 1; i < (unsigned int)argc; i++) {

		if (!strcmp(argv[i], "--help") ||
		    !strcmp(argv[i], "-h")) {

			print_usage(argv[0]);
			return 0;
		}

		if (!strcmp(argv[i], "--machine")) {
			machine_output = 1;
			continue;
		}

		if (!strcmp(argv[i], "--algo")) {
			if (i + 1 >= (unsigned int)argc) {
				fprintf(
					stderr,
					"Error: --algo requires a value\n"
				);
				return 1;
			}

			algorithm = find_algorithm(argv[++i]);

			if (!algorithm) {
				fprintf(
					stderr,
					"Error: unsupported algorithm '%s'\n",
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

		if (!strcmp(argv[i], "--threads")) {
			if (i + 1 >= (unsigned int)argc) {
				fprintf(
					stderr,
					"Error: --threads requires a value\n"
				);
				return 1;
			}

			if (!parse_uint(argv[++i], &threads) ||
			    threads < MIN_THREADS) {

				fprintf(
					stderr,
					"Error: invalid thread count '%s'\n",
					argv[i]
				);
				return 1;
			}

			continue;
		}

		if (!strcmp(argv[i], "--duration")) {
			if (i + 1 >= (unsigned int)argc) {
				fprintf(
					stderr,
					"Error: --duration requires a value\n"
				);
				return 1;
			}

			if (!parse_uint64(
				argv[++i],
				&duration_seconds
			) || duration_seconds < MIN_DURATION) {

				fprintf(
					stderr,
					"Error: invalid duration '%s'\n",
					argv[i]
				);
				return 1;
			}

			continue;
		}

		/*
		 * Keep backward compatibility with the old benchmark by
		 * providing a useful error rather than silently interpreting
		 * positional arguments.
		 */
		fprintf(
			stderr,
			"Error: unknown argument '%s'\n\n",
			argv[i]
		);

		print_usage(argv[0]);
		return 1;
	}


	/* ------------------------------------------------------------------ */
	/* Defaults                                                            */
	/* ------------------------------------------------------------------ */

	if (!algorithm)
		algorithm = find_algorithm("YespowerMwc");


	/* ------------------------------------------------------------------ */
	/* Prevent duration overflow                                           */
	/* ------------------------------------------------------------------ */

	if (duration_seconds >
	    UINT64_MAX / 1000000000ULL) {

		fprintf(
			stderr,
			"Error: benchmark duration is too large\n"
		);

		return 1;
	}


	/* ------------------------------------------------------------------ */
	/* Allocate thread state                                               */
	/* ------------------------------------------------------------------ */

	thread_handles = (pthread_t *)calloc(
		threads,
		sizeof(*thread_handles)
	);

	thread_data = (benchmark_thread_t *)calloc(
		threads,
		sizeof(*thread_data)
	);

	if (!thread_handles || !thread_data) {

		fprintf(
			stderr,
			"Error: unable to allocate benchmark thread data\n"
		);

		free(thread_handles);
		free(thread_data);

		return 1;
	}


	/* ------------------------------------------------------------------ */
	/* Verify yespower before starting the timed benchmark                 */
	/* ------------------------------------------------------------------ */

	{
		uint8_t test_header[80];
		yespower_binary_t test_hash;

		build_header(test_header, 0);

		if (yespower_tls(
			test_header,
			sizeof(test_header),
			&algorithm->params,
			&test_hash
		)) {

			fprintf(
				stderr,
				"Error: yespower self-test failed for %s\n",
				algorithm->name
			);

			free(thread_handles);
			free(thread_data);

			return 1;
		}
	}


	/* ------------------------------------------------------------------ */
	/* Start benchmark                                                     */
	/* ------------------------------------------------------------------ */

	start_ns = time_ns();

	if (!start_ns) {
		fprintf(
			stderr,
			"Error: unable to obtain monotonic clock\n"
		);

		free(thread_handles);
		free(thread_data);

		return 1;
	}

	/*
	 * Give all threads a common future start point.
	 */
	start_ns += START_DELAY_NS;

	end_ns =
		start_ns +
		(duration_seconds * 1000000000ULL);


	if (!machine_output) {
		printf(
			"\n"
			"Sugarmaker CPU Benchmark\n"
			"========================\n"
			"Algorithm : %s\n"
			"Version   : Yespower 1.0.1\n"
			"N         : %u\n"
			"r         : %u\n"
			"Threads   : %u\n"
			"Duration  : %" PRIu64 " seconds\n"
			"\n",
			algorithm->name,
			algorithm->params.N,
			algorithm->params.r,
			threads,
			duration_seconds
		);

		fflush(stdout);
	}


	/* ------------------------------------------------------------------ */
	/* Create benchmark threads                                            */
	/* ------------------------------------------------------------------ */

	actual_start_ns = time_ns();

	for (i = 0; i < threads; i++) {

		thread_data[i].algorithm = algorithm;
		thread_data[i].thread_id = i;
		thread_data[i].start_ns = start_ns;
		thread_data[i].end_ns = end_ns;
		thread_data[i].hashes = 0;
		thread_data[i].checksum = 0;
		thread_data[i].failed = 0;

		if (pthread_create(
			&thread_handles[i],
			NULL,
			benchmark_thread,
			&thread_data[i]
		) != 0) {

			fprintf(
				stderr,
				"Error: failed to create benchmark "
				"thread %u\n",
				i
			);

			exit_code = 1;
			break;
		}
	}

	/*
	 * Join every thread that was successfully created.
	 */
	{
		unsigned int created = i;

		for (i = 0; i < created; i++) {
			if (pthread_join(
				thread_handles[i],
				NULL
			) != 0) {

				fprintf(
					stderr,
					"Error: failed to join benchmark "
					"thread %u\n",
					i
				);

				exit_code = 1;
			}
		}
	}


	/* ------------------------------------------------------------------ */
	/* Check benchmark threads                                             */
	/* ------------------------------------------------------------------ */

	for (i = 0; i < threads; i++) {

		if (thread_data[i].failed) {
			fprintf(
				stderr,
				"Error: benchmark thread %u "
				"reported a Yespower failure\n",
				i
			);

			exit_code = 1;
		}

		total_hashes += thread_data[i].hashes;
		total_checksum ^= thread_data[i].checksum;
	}

	benchmark_sink ^= total_checksum;


	if (exit_code) {
		free(thread_handles);
		free(thread_data);

		return exit_code;
	}


	/* ------------------------------------------------------------------ */
	/* Calculate result                                                    */
	/* ------------------------------------------------------------------ */

	actual_end_ns = time_ns();

	if (actual_end_ns <= actual_start_ns) {
		fprintf(
			stderr,
			"Error: benchmark clock produced an invalid "
			"elapsed time\n"
		);

		free(thread_handles);
		free(thread_data);

		return 1;
	}

	elapsed_seconds =
		(double)(actual_end_ns - actual_start_ns) /
		1000000000.0;

	hashrate_hps =
		(double)total_hashes /
		elapsed_seconds;

	per_thread_hps =
		hashrate_hps /
		(double)threads;


	/* ------------------------------------------------------------------ */
	/* Machine-readable output                                             */
	/* ------------------------------------------------------------------ */

	if (machine_output) {

		printf(
			"BENCHMARK_RESULT "
			"algo=%s "
			"threads=%u "
			"hashrate_hps=%.2f "
			"duration_seconds=%" PRIu64
			"\n",
			algorithm->name,
			threads,
			hashrate_hps,
			duration_seconds
		);

	} else {

		printf(
			"Benchmark complete\n"
			"------------------\n"
			"Algorithm       : %s\n"
			"Threads         : %u\n"
			"Hashes          : %" PRIu64 "\n"
			"Elapsed         : %.3f seconds\n"
			"Hashrate        : %.2f H/s\n"
			"Per-thread      : %.2f H/s\n",
			algorithm->name,
			threads,
			total_hashes,
			elapsed_seconds,
			hashrate_hps,
			per_thread_hps
		);

		printf(
			"\n"
			"BENCHMARK_RESULT "
			"algo=%s "
			"threads=%u "
			"hashrate_hps=%.2f "
			"duration_seconds=%" PRIu64
			"\n",
			algorithm->name,
			threads,
			hashrate_hps,
			duration_seconds
		);
	}


	/* ------------------------------------------------------------------ */
	/* Cleanup                                                             */
	/* ------------------------------------------------------------------ */

	free(thread_handles);
	free(thread_data);

	return 0;
}
