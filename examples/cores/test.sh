#!/bin/sh
# Builds cores with warnings as errors, asks for 1, 2 and 4 threads, and
# checks the sums and averages. Which CPU each thread finished on changes
# from run to run, so those numbers are not compared.
set -eu
cd "$(dirname "$0")"
make --always-make CFLAGS="-std=c17 -Wall -Wextra -Werror -O0 -g -fstack-protector-strong -fPIE -pthread"
printf '1\n2\nabc\n9\n4\n0\n' | ./cores | sed -E 's/on CPU [0-9]+/on CPU N/g' > actual.txt
cat > expected.txt <<'OUT'
How many threads (1 to 4, 0 to stop)? thread 1: marks 0 to 999999 add up to 49999950 (finished on CPU N)
average of 1000000 marks: 49.99995
How many threads (1 to 4, 0 to stop)? thread 1: marks 0 to 499999 add up to 24998725 (finished on CPU N)
thread 2: marks 500000 to 999999 add up to 25001225 (finished on CPU N)
average of 1000000 marks: 49.99995
How many threads (1 to 4, 0 to stop)? How many threads (1 to 4, 0 to stop)? How many threads (1 to 4, 0 to stop)? thread 1: marks 0 to 249999 add up to 12499050 (finished on CPU N)
thread 2: marks 250000 to 499999 add up to 12499675 (finished on CPU N)
thread 3: marks 500000 to 749999 add up to 12500300 (finished on CPU N)
thread 4: marks 750000 to 999999 add up to 12500925 (finished on CPU N)
average of 1000000 marks: 49.99995
How many threads (1 to 4, 0 to stop)? 
OUT
# The last prompt has no newline after it; the heredoc adds one.
printf '\n' >> actual.txt
diff -u expected.txt actual.txt
rm -f expected.txt actual.txt
echo "cores: output as expected"
