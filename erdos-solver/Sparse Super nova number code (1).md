\# \-\*- coding: utf-8 \-\*-  
"""  
An enhanced, deterministic sparse encoder for numerical data streams.

This implementation synthesizes the best features of multiple approaches,  
offering a robust, configurable, and production-ready tool for converting  
numerical vectors into high-dimensional sparse signatures.  
"""

from \_\_future\_\_ import annotations

import hashlib  
import warnings  
from dataclasses import dataclass  
from typing import Dict, List, Mapping, Optional, Sequence, Set, Tuple

import numpy as np  
import numpy.typing as npt

\# \----------------------------  
\# Data Structures & Configuration  
\# \----------------------------

@dataclass(frozen=True)  
class DataSparseSignature:  
    """  
    Immutable representation of a sparse signature.

    Attributes:  
        positions: Tuple of active indices in the sparse vector.  
        elevations: Tuple of corresponding values (magnitudes) at active positions.  
        dimension: The total dimensionality of the sparse vector.  
        sparsity: The fraction of non-zero elements.  
        version: The version of the encoding algorithm used.  
        salt\_id: The salt or seed used for hashing.  
        modality: The type of data encoded.  
    """  
    positions: Tuple\[int, ...\]  
    elevations: Tuple\[float, ...\]  
    dimension: int  
    sparsity: float  
    version: str  
    salt\_id: str  
    modality: str \= "data"

    def \_\_post\_init\_\_(self):  
        """Validates the integrity of the signature after creation."""  
        if len(self.positions) \!= len(self.elevations):  
            raise ValueError("Positions and elevations must have the same length.")  
        if not (0 \<= self.sparsity \<= 1):  
            raise ValueError("Sparsity must be between 0 and 1.")  
        if any(not (0 \<= pos \< self.dimension) for pos in self.positions):  
            raise ValueError(f"All positions must be within \[0, {self.dimension}).")

@dataclass  
class DataSupernovaConfig:  
    """  
    Configuration for the Data Supernova encoder, with tunable parameters.  
    """  
    dimension: int \= 2048  
    max\_positions: int \= 64  
    density\_window: Tuple\[float, float\] \= (0.01, 0.08)  
    seed: str \= "supernova\_data\_v1"  
      
    \# \--- Tunable Elevation Weights \---  
    w\_z: float \= 1.0          \# Weight for Z-score magnitude  
    w\_rel\_delta: float \= 0.8  \# Weight for relative change |delta/std|  
    w\_quantile: float \= 0.6   \# Weight for robust quantile |x \- median|/MAD  
    w\_anom\_flag: float \= 0.7  \# Weight for anomaly flag  
    anom\_z\_threshold: float \= 2.2  
      
    \# \--- Numerical Safety & Shaping \---  
    epsilon: float \= 1e-9  
    clip\_before\_tanh: float \= 6.0  \# Clip raw score before tanh shaping  
    scale\_after\_tanh: float \= 4.0  \# Final cap for elevation after tanh  
    version: str \= "data-supernova-v2.0"

    def \_\_post\_init\_\_(self):  
        """Validates configuration parameters."""  
        if self.dimension \<= 0 or self.max\_positions \<= 0:  
            raise ValueError("Dimension and max\_positions must be positive.")  
        if not (0 \< self.density\_window\[0\] \<= self.density\_window\[1\] \<= 1):  
            raise ValueError("Invalid density window. Must be (min, max) between 0 and 1.")  
        if self.max\_positions \> self.dimension:  
            warnings.warn("max\_positions \> dimension. The number of features will be capped by dimension.")

\# \----------------------------  
\# Helper Functions  
\# \----------------------------

def \_sanitize(a: npt.ArrayLike, fill: float \= 0.0) \-\> np.ndarray:  
    """Replaces NaN/Inf values in a numpy array with a fill value."""  
    out \= np.array(a, dtype=np.float64, copy=True)  
    mask \= \~np.isfinite(out)  
    if mask.any():  
        out\[mask\] \= fill  
    return out

def \_hash\_blake2b\_64(key\_bytes: bytes, \*parts: bytes) \-\> int:  
    """Creates a 64-bit hash using BLAKE2b."""  
    h \= hashlib.blake2b(digest\_size=8, key=key\_bytes)  
    for p in parts:  
        h.update(p)  
    return int.from\_bytes(h.digest(), "big")

def \_hash\_floats\_to\_pos(vals: Sequence\[float\], seed: str, purpose: str, dim: int) \-\> int:  
    """Hashes a sequence of floats to a position within the dimension."""  
    key \= seed.encode("utf-8")  
    purpose\_bytes \= purpose.encode("utf-8")  
    arr\_bytes \= np.asarray(vals, dtype=np.float64).tobytes()  
    return \_hash\_blake2b\_64(key, purpose\_bytes, arr\_bytes) % dim

def \_tie\_breaker\_hash(i: int, v: float, seed: str) \-\> int:  
    """Creates a deterministic tie-breaker hash for stable sorting."""  
    key \= seed.encode("utf-8")  
    purpose\_bytes \= b"tiebreak"  
    payload \= np.asarray(\[i, v\], dtype=np.float64).tobytes()  
    return \_hash\_blake2b\_64(key, purpose\_bytes, payload)

def \_resolve\_collision(pos: int, taken: Set\[int\], seed: str, base\_vals: Sequence\[float\], dim: int) \-\> int:  
    """Finds an empty slot using deterministic linear probing if a hash collision occurs."""  
    if pos not in taken:  
        return pos  
    \# Attempt to find a new position by rehashing with a counter  
    for i in range(1, 16):  
        new\_pos \= \_hash\_floats\_to\_pos(\[\*base\_vals, float(i)\], seed, "collision\_rehash", dim)  
        if new\_pos not in taken:  
            return new\_pos  
    \# Fallback to linear stepping if rehashing fails (extremely rare)  
    step \= 1 \+ (\_hash\_floats\_to\_pos(base\_vals, seed, "linear\_step", dim) % (dim // 7))  
    curr\_pos \= pos  
    for \_ in range(16, 272): \# Bounded search  
        curr\_pos \= (curr\_pos \+ step) % dim  
        if curr\_pos not in taken:  
            return curr\_pos  
    return pos \# Worst case: return original position (overwrite)

def \_calculate\_k(dim: int, max\_pos: int, density: Tuple\[float, float\], n\_feats: int) \-\> int:  
    """Calculates the exact number of features (k) to keep based on density constraints."""  
    d\_min, d\_max \= density  
    k\_min \= int(np.floor(dim \* max(d\_min, 1.0 / dim)))  
    k\_max \= int(np.ceil(dim \* min(d\_max, max\_pos / float(dim))))  
    k \= min(k\_max, max\_pos) \# Respect absolute max positions  
    return max(1, min(k, n\_feats)) \# Cannot be more than available features

\# \----------------------------  
\# Main Encoder Class  
\# \----------------------------

class DataSupernovaEncoder:  
    """  
    A robust, deterministic sparse encoder for numerical data.  
    """  
    def \_\_init\_\_(self, config: Optional\[DataSupernovaConfig\] \= None):  
        self.config \= config or DataSupernovaConfig()

    def encode(  
        self,  
        vector: Sequence\[float\],  
        stats: Mapping\[str, Sequence\[float\]\],  
        regime\_tags: Optional\[Mapping\[str, float\]\] \= None  
    ) \-\> DataSparseSignature:  
        """  
        Encodes a numerical vector into a deterministic sparse signature.

        Args:  
            vector: The input numerical data vector (e.g., \[open, high, low, close\]).  
            stats: A dictionary of rolling statistics: 'mean', 'std', 'median', 'mad', 'prev'.  
            regime\_tags: Optional dictionary for contextual tags (e.g., {'tod': 9}).

        Returns:  
            A DataSparseSignature object representing the encoded vector.  
        """  
        cfg \= self.config  
        arr \= \_sanitize(np.asarray(vector, dtype=np.float64))

        \# \--- 1\. Feature Engineering \---  
        stats\_map \= {k: \_sanitize(np.asarray(v)) for k, v in (stats or {}).items()}  
        mean   \= stats\_map.get("mean", np.zeros\_like(arr))  
        std    \= np.maximum(stats\_map.get("std", np.ones\_like(arr)), cfg.epsilon)  
        median \= stats\_map.get("median", np.zeros\_like(arr))  
        mad    \= np.maximum(stats\_map.get("mad", np.ones\_like(arr)), cfg.epsilon)  
        prev   \= stats\_map.get("prev", arr)

        z\_scores \= (arr \- mean) / std  
        rel\_delta \= (arr \- prev) / std  
        quantiles \= (arr \- median) / mad  
        anom\_flags \= (np.abs(z\_scores) \> cfg.anom\_z\_threshold).astype(np.float64)

        \# \--- 2\. Calculate Weighted Elevations \---  
        elevations\_raw \= (  
            cfg.w\_z \* np.abs(z\_scores) \+  
            cfg.w\_rel\_delta \* np.abs(rel\_delta) \+  
            cfg.w\_quantile \* np.abs(quantiles) \+  
            cfg.w\_anom\_flag \* anom\_flags  
        )  
          
        \# Combine all features and their calculated elevations  
        all\_features \= \[  
            ("z", z\_scores), ("rel\_delta", rel\_delta), ("quantile", quantiles), ("anom", anom\_flags)  
        \]  
        if regime\_tags:  
            keys \= sorted(regime\_tags.keys())  
            regime\_vec \= np.asarray(\[float(regime\_tags\[k\]) for k in keys\])  
            all\_features.append(("regime", regime\_vec))

        \# \--- 3\. Generate Positions and Final Elevations \---  
        k \= \_calculate\_k(cfg.dimension, cfg.max\_positions, cfg.density\_window, len(elevations\_raw))  
          
        candidates \= \[\]  
        taken\_pos: Set\[int\] \= set()

        \# Process base features  
        for i, raw\_elev in enumerate(elevations\_raw):  
            \# Position is based on the feature's identity (index) and value  
            base\_hash\_vals \= \[float(i), arr\[i\]\]  
            pos \= \_hash\_floats\_to\_pos(base\_hash\_vals, cfg.seed, f"feat\_{i}", cfg.dimension)  
            pos \= \_resolve\_collision(pos, taken\_pos, cfg.seed, base\_hash\_vals, cfg.dimension)  
            taken\_pos.add(pos)  
              
            \# Shape elevation: clip \-\> tanh \-\> scale  
            shaped\_elev \= np.tanh(np.clip(raw\_elev, \-cfg.clip\_before\_tanh, cfg.clip\_before\_tanh))  
            final\_elev \= abs(shaped\_elev) \* cfg.scale\_after\_tanh  
              
            tie\_breaker \= \_tie\_breaker\_hash(i, arr\[i\], cfg.seed)  
            candidates.append({'pos': pos, 'elev': final\_elev, 'tie': tie\_breaker})

        \# Process regime features separately  
        if regime\_tags:  
            for key, val in sorted(regime\_tags.items()):  
                base\_hash\_vals \= \[val\] \# Hash on value  
                pos \= \_hash\_floats\_to\_pos(base\_hash\_vals, cfg.seed, f"regime\_{key}", cfg.dimension)  
                pos \= \_resolve\_collision(pos, taken\_pos, cfg.seed, base\_hash\_vals, cfg.dimension)  
                taken\_pos.add(pos)  
                  
                \# Elevation for regimes is based on their magnitude  
                final\_elev \= abs(np.tanh(val)) \* cfg.scale\_after\_tanh  
                tie\_breaker \= \_tie\_breaker\_hash(0, val, cfg.seed)  
                candidates.append({'pos': pos, 'elev': final\_elev, 'tie': tie\_breaker})

        \# \--- 4\. Deterministic Top-K Selection \---  
        \# Sort by elevation (desc), then by tie-breaker (desc) for stability  
        candidates.sort(key=lambda x: (x\['elev'\], x\['tie'\]), reverse=True)  
          
        top\_k \= candidates\[:k\]  
          
        final\_positions \= tuple(c\['pos'\] for c in top\_k)  
        final\_elevations \= tuple(round(c\['elev'\], 6\) for c in top\_k)

        return DataSparseSignature(  
            positions=final\_positions,  
            elevations=final\_elevations,  
            dimension=cfg.dimension,  
            sparsity=len(final\_positions) / float(cfg.dimension),  
            version=cfg.version,  
            salt\_id=cfg.seed,  
        )

\# \----------------------------  
\# Example Usage  
\# \----------------------------  
if \_\_name\_\_ \== "\_\_main\_\_":  
    \# 1\. Define configuration  
    config \= DataSupernovaConfig(  
        dimension=4096,  
        max\_positions=128,  
        density\_window=(0.01, 0.04),  
        seed="my\_finance\_project\_salt\_v3",  
    )

    \# 2\. Create the encoder instance  
    encoder \= DataSupernovaEncoder(config)

    \# 3\. Simulate incoming data (e.g., a new OHLCV bar)  
    row\_data \= np.array(\[101.2, 103.0, 100.7, 102.5, 1\_250\_000.0\])

    \# 4\. Provide rolling statistics for context  
    stats\_data \= {  
        "mean":   np.array(\[100.9, 102.8, 100.5, 102.1, 1\_100\_000.0\]),  
        "std":    np.array(\[  0.6,   0.7,   0.5,   0.6,   150\_000.0\]),  
        "median": np.array(\[101.0, 102.9, 100.6, 102.2, 1\_120\_000.0\]),  
        "mad":    np.array(\[  0.4,   0.5,   0.4,   0.4,   120\_000.0\]),  
        "prev":   np.array(\[100.8, 102.7, 100.4, 102.0, 1\_230\_000.0\]),  
    }  
      
    \# 5\. Provide optional context tags  
    context\_data \= {"volatility\_regime": 2.0, "time\_of\_day": 11.0}

    \# 6\. Encode the data  
    signature \= encoder.encode(row\_data, stats\_data, context\_data)

    \# 7\. Print the results  
    print("--- Generated Sparse Signature \---")  
    print(f"Configuration used: {config.seed} (v{config.version})")  
    print(f"Dimension: {signature.dimension}")  
    print(f"Active Features (k): {len(signature.positions)}")  
    print(f"Sparsity: {signature.sparsity:.5f}")  
    print("\\nTop 10 Positions and Elevations (sorted by position):")  
      
    \# Sort for display purposes  
    display\_list \= sorted(zip(signature.positions, signature.elevations))\[:10\]  
    for p, e in display\_list:  
        print(f"  Position: {p:\<5} | Elevation: {e:.4f}")

