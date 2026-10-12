# Builds marks the way the Yanix lab describes it: no optimisation, so every
# local variable has its own place on the stack; debug information for gdb; a
# stack canary and a position-independent executable, as most distributions
# do by default anyway.
CC ?= cc
CFLAGS ?= -std=c17 -Wall -Wextra -O0 -g -fstack-protector-strong -fPIE
LDFLAGS ?= -pie

marks: marks.c
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $<

clean:
	rm -f marks

.PHONY: clean
