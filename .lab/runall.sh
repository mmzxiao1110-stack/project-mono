cd /home/user/project-mono
for s in "$@"; do node .lab/tourney.mjs $s ${GAMES:-16} $VS > .lab/out-$s.txt 2>&1 & done; wait
cat .lab/out-*.txt
