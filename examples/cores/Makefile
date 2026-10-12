# Builds cores the way the Yanix lab describes it: no optimisation, so every
# local variable has its own place on the stack; debug information for gdb; a
# stack canary and a position-independent executable, as most distributions
# do by default anyway; and -pthread for POSIX threads.
CC ?= cc
CFLAGS ?= -std=c17 -Wall -Wextra -O0 -g -fstack-protector-strong -fPIE -pthread
LDFLAGS ?= -pie -pthread

cores: cores.c
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $<

clean:
	rm -f cores

.PHONY: clean
