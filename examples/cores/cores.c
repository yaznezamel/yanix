/*
 * cores.c: a million marks, added up on several cores at once.
 *
 * main() fills an array with a million marks, then asks how many threads to
 * use. Each thread adds up its own slice of the array, on a core of its own:
 * every thread has its own registers and its own stack, while the array, the
 * code and the rest of the process's memory are shared by all of them. main()
 * waits for each thread, adds up their results and prints the average.
 *
 *   make && ./cores
 *
 * The Yanix desktop lab traces this program down to the scheduler and the
 * CPU's cores; README.md shows how to watch it for real with strace and gdb.
 */
#define _GNU_SOURCE /* for sched_getcpu() */
#include <pthread.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>

#define MARKS 1000000
#define MAX_THREADS 4

struct slice {
	const int *marks; /* the whole array: every thread shares it */
	size_t first;     /* where this thread's part starts */
	size_t count;     /* how many marks it adds up */
	long sum;         /* the thread's result */
	int cpu;          /* the CPU the thread finished on */
};

/* Each new thread starts here, with a stack of its own. */
static void *add_up(void *arg)
{
	struct slice *slice = arg; /* points into main()'s stack */
	long sum = 0;              /* on this thread's stack */

	for (size_t i = slice->first; i < slice->first + slice->count; i++)
		sum += slice->marks[i];
	slice->sum = sum;
	slice->cpu = sched_getcpu();
	return NULL;
}

int main(void)
{
	/* 4 MB: too big for the heap's usual space, so malloc() maps it on its own */
	int *marks = malloc(MARKS * sizeof *marks);
	if (!marks)
		return 1;
	for (size_t i = 0; i < MARKS; i++)
		marks[i] = i % 101;

	char line[16];
	for (;;) {
		printf("How many threads (1 to %d, 0 to stop)? ", MAX_THREADS);
		if (!fgets(line, sizeof line, stdin))
			break;
		int threads;
		if (sscanf(line, "%d", &threads) != 1 || threads < 0 || threads > MAX_THREADS)
			continue;
		if (threads == 0)
			break;

		pthread_t ids[MAX_THREADS];
		struct slice slices[MAX_THREADS]; /* main()'s stack, shared with the threads */
		size_t per = MARKS / threads;

		for (int t = 0; t < threads; t++) {
			slices[t] = (struct slice){
				.marks = marks,
				.first = t * per,
				.count = t == threads - 1 ? MARKS - t * per : per,
			};
			if (pthread_create(&ids[t], NULL, add_up, &slices[t]) != 0)
				return 1;
		}

		long total = 0;
		for (int t = 0; t < threads; t++) {
			pthread_join(ids[t], NULL); /* sleeps until thread t has finished */
			total += slices[t].sum;
			printf("thread %d: marks %zu to %zu add up to %ld (finished on CPU %d)\n", t + 1,
			       slices[t].first, slices[t].first + slices[t].count - 1, slices[t].sum,
			       slices[t].cpu);
		}
		printf("average of %d marks: %.5f\n", MARKS, (double)total / MARKS);
	}
	free(marks);
	return 0;
}
