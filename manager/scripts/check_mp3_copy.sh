#!/bin/bash
# the browser copy of the MP3 checker must equal the Worker one
cd "$(dirname "$0")/.." && cmp src/mp3.js src/ui/mp3.js.txt && echo "mp3.js copy OK"
