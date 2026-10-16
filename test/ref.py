import sys, subprocess, base64
from shazamio.algorithm import SignatureGenerator
raw = subprocess.run(["ffmpeg","-nostdin","-v","error","-i",sys.argv[1],"-vn","-ss","0","-t","12","-ac","1","-ar","16000","-f","s16le","-"],capture_output=True).stdout
import array
a = array.array("h"); a.frombytes(raw)
g = SignatureGenerator(); g.MAX_TIME_SECONDS = 1e9; g.MAX_PEAKS = 10**9
g.feed_input(list(a))
sig = g.get_next_signature()
open(sys.argv[2],"wb").write(sig.encode_to_binary())
