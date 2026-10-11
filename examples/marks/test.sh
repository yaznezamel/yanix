#!/bin/sh
# Builds marks with warnings as errors, types in the lines the lab's
# measurements used (a wrong line of marks included) and checks the output.
# On a pipe stdout is fully buffered, so the prompts come out together at the
# end, but in the same order as on a terminal.
set -eu
cd "$(dirname "$0")"
make --always-make CFLAGS="-std=c17 -Wall -Wextra -Werror -O0 -g -fstack-protector-strong -fPIE"
printf 'Yazn\n72 85 90\ny\nSam\n60 70 80\ny\nLee\n50 abc\n50 60 70\nn\n' | ./marks > actual.txt
printf '%s' 'Student name: Marks for Yazn (3 numbers, 0 to 100): Add another student? (y/n) ' > expected.txt
printf '%s' 'Student name: Marks for Sam (3 numbers, 0 to 100): Add another student? (y/n) ' >> expected.txt
printf '%s' 'Student name: Marks for Lee (3 numbers, 0 to 100): Please type 3 whole numbers from 0 to 100: ' >> expected.txt
printf '%s\n' 'Add another student? (y/n) Yazn          72  85  90   average  82.3' >> expected.txt
printf '%s\n' 'Sam           60  70  80   average  70.0' >> expected.txt
printf '%s\n' 'Lee           50  60  70   average  60.0' >> expected.txt
diff -u expected.txt actual.txt
rm -f expected.txt actual.txt
echo "marks: output as expected"
