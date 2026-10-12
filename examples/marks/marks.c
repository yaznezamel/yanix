/*
 * marks.c: a class's marks, kept on the stack and on the heap.
 *
 * Type each student's name and three marks. The program copies each name to
 * the heap, keeps the students in an array on the heap that grows by one each
 * time, then prints everyone's average. It is small on purpose: every
 * variable is there to show where data lives while a program runs.
 *
 *   make && ./marks
 *
 * The Yanix desktop lab traces this program from the keyboard to the kernel
 * and the hardware; README.md shows how to watch it for real with strace,
 * gdb and /proc.
 */
#define _POSIX_C_SOURCE 200809L /* strdup() is POSIX, not ISO C17 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SUBJECTS 3

struct student {
	char *name;          /* points to a copy of the name, on the heap */
	int marks[SUBJECTS]; /* the marks themselves, inside the struct */
};

/*
 * Reads a line of marks into line[] and parses it into marks[]: 1 if there
 * are three whole numbers from 0 to 100, 0 if not, -1 at the end of input.
 * Both arrays belong to main(): this function only gets pointers to them.
 */
static int read_marks(char line[], int size, int marks[])
{
	if (!fgets(line, size, stdin))
		return -1;
	if (sscanf(line, "%d %d %d", &marks[0], &marks[1], &marks[2]) != SUBJECTS)
		return 0;
	for (int i = 0; i < SUBJECTS; i++)
		if (marks[i] < 0 || marks[i] > 100)
			return 0;
	return 1;
}

/* Gets a stack frame of its own for its locals, below main()'s. */
static double average(const int marks[], int n)
{
	int sum = 0;

	for (int i = 0; i < n; i++)
		sum += marks[i];
	return (double)sum / n;
}

int main(void)
{
	char line[64];                     /* stack: the line you just typed */
	struct student s;                  /* stack: the student being typed in */
	struct student *students = NULL;   /* stack: points to the array on the heap */
	size_t count = 0;                  /* stack: how many students so far */

	for (;;) {
		printf("Student name: ");
		if (!fgets(line, sizeof line, stdin))
			break;
		line[strcspn(line, "\n")] = '\0';
		s.name = strdup(line);     /* heap: a copy of the name, just big enough */
		if (!s.name)
			break;

		printf("Marks for %s (3 numbers, 0 to 100): ", s.name);
		int got;
		while ((got = read_marks(line, sizeof line, s.marks)) == 0)
			printf("Please type 3 whole numbers from 0 to 100: ");
		if (got < 0) {
			free(s.name);
			break;
		}

		/* heap: the array grows by one student, and may move to do so */
		struct student *grown = realloc(students, (count + 1) * sizeof *students);
		if (!grown) {
			free(s.name);
			break;
		}
		students = grown;
		students[count++] = s;     /* copies the name pointer and the marks */

		printf("Add another student? (y/n) ");
		if (!fgets(line, sizeof line, stdin) || (line[0] != 'y' && line[0] != 'Y'))
			break;
	}

	for (size_t i = 0; i < count; i++)
		printf("%-12s %3d %3d %3d   average %5.1f\n", students[i].name,
		       students[i].marks[0], students[i].marks[1], students[i].marks[2],
		       average(students[i].marks, SUBJECTS));

	for (size_t i = 0; i < count; i++)
		free(students[i].name);
	free(students);
	return 0;
}
