rh\_sparse\_anomaly.py  
\# \-\*- coding: utf-8 \-\*-  
"""  
Riemann zeros → normalized gaps → Sparse signature → multi-scale anomaly trace.

What this file demonstrates:  
\- Generate an approximate sequence of imaginary parts of non-trivial zeros γ\_k  
  via inverting the Riemann–von Mangoldt counting function N(T) ≈ x log x \- x \+ 7/8,  
  where x \= T/(2π).  
\- Convert {γ\_k} to normalized gaps s\_k ≈ (γ\_{k+1}-γ\_k) \* log(γ\_k / (2π)) / (2π),  
  which should (heuristically) follow GUE spacing.  
\- Slide a window over s\_k, encode each window into a sparse signature  
  (deterministic, seed-stable, high-dimensional but top-k positions only).  
\- Feed signatures into a multi-scale anomaly detector (kNN-cosine to recent history),  
  returning a per-scale and combined anomaly score — the "anomaly trace track".

Dependencies: numpy only.  
"""

from \_\_future\_\_ import annotations  
import math  
import hashlib  
from dataclasses import dataclass  
from typing import Dict, Iterable, List, Tuple  
from collections import deque, defaultdict

import numpy as np

\# \-----------------------------  
\# 1\) RH zeros: N(T) and inversion  
\# \-----------------------------

TAU \= 2.0 \* math.pi

def N\_riemann(T: float) \-\> float:  
    """  
    Riemann–von Mangoldt count approximation:  
      N(T) \= (T/(2π)) log(T/(2π)) \- (T/(2π)) \+ 7/8 \+ O(1/T)  
    Sufficient for generating a plausible, monotone γ\_k sequence for demo.  
    """  
    if T \<= 0.0:  
        return 0.0  
    x \= T / TAU  
    return x \* math.log(x) \- x \+ 0.875

def invert\_N\_for\_k(k: int, iters: int \= 12\) \-\> float:  
    """  
    Invert N(T) \~ k by Newton's method.  
    f(T) \= N(T) \- k,  f'(T) \= (1/(2π)) \* log(T/(2π))  
    Provide a reasonable initial guess for T.  
    """  
    if k \< 1:  
        return 0.0  
    \# crude initial guess: x \~ k / log(max(k,3)), then T \= 2πx  
    x0 \= max(2.5, k / max(1.0, math.log(max(k, 3.0))))  
    T \= TAU \* x0  
    for \_ in range(iters):  
        x \= max(1e-9, T / TAU)  
        f \= x \* math.log(x) \- x \+ 0.875 \- k  
        df \= (1.0 / TAU) \* max(1e-12, math.log(x))  
        T \-= f / df  
        if T \<= 0:  
            T \= 1.0  
    return float(T)

def generate\_gammas(K: int) \-\> np.ndarray:  
    """  
    Produce K approximate imaginary parts of non-trivial zeros {γ\_k}.  
    (Monotone increasing, reasonable spacing; not certified.)  
    """  
    gammas \= np.array(\[invert\_N\_for\_k(k) for k in range(1, K \+ 1)\], dtype=float)  
    return gammas

def normalized\_gaps(gammas: np.ndarray) \-\> np.ndarray:  
    """  
    s\_k \= (γ\_{k+1}-γ\_k) \* log(γ\_k / (2π)) / (2π)  
    Theoretical/heuristic target (GUE spacing) has mean ≈ 1\.  
    """  
    g \= np.array(gammas, dtype=float)  
    g \= g\[np.isfinite(g) & (g \> 0)\]  
    if g.size \< 2:  
        return np.zeros(0, dtype=float)  
    gaps \= g\[1:\] \- g\[:-1\]  
    \# local scaling factor \~ density of zeros ≈ (1/2π)\*log(T/2π)  
    scale \= np.log(g\[:-1\] / TAU) / TAU  
    s \= gaps \* scale  
    \# keep positive finite values  
    s \= s\[(s \> 0\) & np.isfinite(s)\]  
    return s

\# \-----------------------------------------  
\# 2\) Sparse Supernova–style encoder (minimal)  
\# \-----------------------------------------

@dataclass  
class SparseSignature:  
    positions: List\[int\]  
    elevations: List\[float\]  
    dimension: int  
    sparsity: float  
    version: str \= "sparse-minimal-0.1"  
    salt\_id: str \= "rh\_sparse"

class SparseEncoder:  
    """  
    Deterministic sparse hashing encoder.  
    \- Hash each feature into \[0, D).  
    \- Elevation \= compressed magnitude of standardized channels.  
    \- Keep top-K per window (by elevation), dedupe position via max.  
    """  
    def \_\_init\_\_(self, dimension: int \= 4096, max\_positions: int \= 128, seed: str \= "rh\_sparse"):  
        self.D \= int(dimension)  
        self.K \= int(max\_positions)  
        self.seed \= str(seed)

    def \_hpos(self, i: int, tag: str, val: float) \-\> int:  
        key \= f"{self.seed}|{tag}|{i}|{val:.6f}".encode("utf-8")  
        h \= hashlib.blake2b(key=self.seed.encode("utf-8"), digest\_size=8)  
        h.update(key)  
        return int.from\_bytes(h.digest(), "big") % self.D

    @staticmethod  
    def \_safe(arr: np.ndarray) \-\> np.ndarray:  
        a \= np.asarray(arr, dtype=float).copy()  
        a\[\~np.isfinite(a)\] \= 0.0  
        return a

    def encode(self, x: np.ndarray) \-\> SparseSignature:  
        x \= self.\_safe(x)  
        n \= x.size  
        if n \== 0:  
            return SparseSignature(\[\], \[\], self.D, 0.0, salt\_id=self.seed)

        \# simple robust stats per window  
        mean \= float(np.mean(x))  
        std  \= float(np.std(x) \+ 1e-9)  
        med  \= float(np.median(x))  
        mad  \= float(np.mean(np.abs(x \- med)) \+ 1e-9)

        z   \= (x \- mean) / std  
        q   \= (x \- med) / mad  
        dz  \= np.diff(x, prepend=x\[:1\])  
        dzs \= dz / (std \+ 1e-9)

        \# Channels to hash (tagged)  
        chans \= {  
            "z": np.tanh(np.abs(z)),          \# compress extreme values  
            "q": np.tanh(np.abs(q)),  
            "dz": np.tanh(np.abs(dzs)) \* 0.8,  
        }

        buckets: Dict\[int, float\] \= {}  
        for tag, arr in chans.items():  
            for i, v in enumerate(arr):  
                if v \<= 0.0:  
                    continue  
                pos \= self.\_hpos(i, tag, v)  
                \# keep max elevation per position  
                buckets\[pos\] \= max(buckets.get(pos, 0.0), float(v))

        \# Top-K by elevation  
        if not buckets:  
            return SparseSignature(\[\], \[\], self.D, 0.0, salt\_id=self.seed)  
        items \= sorted(buckets.items(), key=lambda kv: kv\[1\], reverse=True)\[: self.K\]  
        positions \= \[int(p) for p, \_ in items\]  
        elevations \= \[float(e) for \_, e in items\]  
        sparsity \= len(positions) / float(self.D)  
        return SparseSignature(positions, elevations, self.D, sparsity, salt\_id=self.seed)

\# \------------------------------------------------  
\# 3\) Multi-scale anomaly detector (kNN-cosine score)  
\# \------------------------------------------------

SparseDict \= Dict\[int, float\]

def sparse\_cosine(a: SparseDict, b: SparseDict) \-\> float:  
    if not a or not b:  
        return 0.0  
    keys \= set(a) | set(b)  
    dot \= sum(a.get(k, 0.0) \* b.get(k, 0.0) for k in keys)  
    na \= math.sqrt(sum(v \* v for v in a.values()))  
    nb \= math.sqrt(sum(v \* v for v in b.values()))  
    if na \== 0.0 or nb \== 0.0:  
        return 0.0  
    return dot / (na \* nb)

@dataclass  
class \_Ring:  
    buf: deque  
    cap: int

    def push(self, s: SparseDict) \-\> None:  
        self.buf.append(s)  
        while len(self.buf) \> self.cap:  
            self.buf.popleft()

    def topk\_avg(self, q: SparseDict, k: int) \-\> float:  
        if not self.buf:  
            return 0.0  
        sims \= \[sparse\_cosine(q, s) for s in self.buf\]  
        sims.sort(reverse=True)  
        k \= max(1, min(k, len(sims)))  
        return sum(sims\[:k\]) / float(k)

class MultiScaleAnomaly:  
    """  
    Keep a history ring per scale; score each new signature by  
    1 \- avg\_topk\_cosine(q, ring) and average across scales.  
    """  
    def \_\_init\_\_(self, scales: Iterable\[int\] \= (64, 256, 1024), knn\_k: int \= 5):  
        self.scales \= list(scales)  
        self.knn\_k \= int(knn\_k)  
        self.hist: Dict\[int, \_Ring\] \= {s: \_Ring(deque(), cap=int(s)) for s in self.scales}

    @staticmethod  
    def to\_dict(sig: SparseSignature) \-\> SparseDict:  
        return {int(p): float(e) for p, e in zip(sig.positions, sig.elevations)}

    def update\_and\_score(self, sig: SparseSignature) \-\> Tuple\[float, Dict\[int, float\]\]:  
        q \= self.to\_dict(sig)  
        per: Dict\[int, float\] \= {}  
        for s, ring in self.hist.items():  
            avg\_topk \= ring.topk\_avg(q, self.knn\_k)  
            per\[s\] \= float(1.0 \- avg\_topk)  \# higher means more "novel"  
        for ring in self.hist.values():  
            ring.push(q)  
        if per:  
            combined \= float(sum(per.values()) / len(per))  
        else:  
            combined \= 0.0  
        return combined, per

\# \--------------------------------------  
\# 4\) End-to-end: RH → sparse → anomaly  
\# \--------------------------------------

def anomaly\_trace\_from\_rh(  
    K\_zeros: int \= 3000,  
    window: int \= 256,  
    scales: Iterable\[int\] \= (64, 256, 1024),  
    dim: int \= 4096,  
    topk: int \= 128,  
    knn\_k: int \= 5,  
    seed: str \= "rh\_sparse\_demo",  
    inject\_jolt: bool \= True,  
) \-\> List\[Tuple\[int, float, Dict\[int, float\]\]\]:  
    """  
    Produce an anomaly trace over sliding windows of normalized gaps.  
    Returns a list of (index, combined\_score, {scale:score}).  
    If inject\_jolt=True, artificially perturb a small patch to show a spike.  
    """  
    gammas \= generate\_gammas(K\_zeros)  
    s \= normalized\_gaps(gammas)  
    if s.size \< window \+ 2:  
        raise ValueError("Increase K\_zeros or decrease window size.")

    \# Optional: inject a localized "event" to illustrate a clear anomaly  
    if inject\_jolt:  
        i0 \= s.size // 2  
        span \= min(8, s.size \- i0 \- 1\)  
        s\[i0 : i0 \+ span\] \*= 1.8  \# sudden local expansion of gaps

    enc \= SparseEncoder(dimension=dim, max\_positions=topk, seed=seed)  
    det \= MultiScaleAnomaly(scales=scales, knn\_k=knn\_k)

    out: List\[Tuple\[int, float, Dict\[int, float\]\]\] \= \[\]  
    for i in range(window, s.size):  
        win \= s\[i \- window : i\]  
        sig \= enc.encode(win)  
        comb, per \= det.update\_and\_score(sig)  
        out.append((i, comb, per))  
    return out

\# \--------------------------------------  
\# 5\) CLI demo  
\# \--------------------------------------

if \_\_name\_\_ \== "\_\_main\_\_":  
    trace \= anomaly\_trace\_from\_rh(  
        K\_zeros=3000,      \# how many γ\_k to synthesize  
        window=256,        \# sliding window size for encoding  
        scales=(64, 256),  \# keep output small for print; add 1024 if you like  
        dim=4096,  
        topk=128,  
        knn\_k=5,  
        seed="rh\_sparse\_demo",  
        inject\_jolt=True,  
    )

    \# Print a small sample of the anomaly trace (combined \+ per-scale)  
    print("idx\\tcombined\\tper-scale")  
    for j, (i, comb, per) in enumerate(trace):  
        if j % 50 \== 0:  \# print every 50th point to keep output tidy  
            per\_fmt \= ", ".join(f"{k}:{v:.3f}" for k, v in per.items())  
            print(f"{i}\\t{comb:.3f}\\t\\t{per\_fmt}")

    \# Tip: Plotting (optional, if you have matplotlib)  
    \# import matplotlib.pyplot as plt  
    \# xs \= \[i for i, \*\_ in trace\]  
    \# ys \= \[c for \_, c, \_ in trace\]  
    \# plt.plot(xs, ys, label="Combined anomaly")  
    \# plt.legend(); plt.show()

How to read the output

The loop emits an anomaly score per step (plus per‑scale scores).

When the (simulated) sequence experiences a localized deviation (I injected a small spike), the combined anomaly jumps — that’s your anomaly trace track.