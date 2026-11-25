"""解析結果のスレッドセーフ LRU インメモリキャッシュストア。"""

from __future__ import annotations

from collections import OrderedDict
import threading
from typing import Any
from uuid import UUID

from app.models.api_schemas import AnalysisResponse


class AnalysisNotFoundError(KeyError):
    """指定された analysis_id がストア内に存在しない場合の例外（API 404 対応）。"""

    def __init__(self, analysis_id: str | UUID) -> None:
        id_str = str(analysis_id)
        msg = f"指定された analysis_id の解析結果が見つかりません: '{id_str}'"
        super().__init__(msg)
        self.analysis_id = id_str
        self.code = "ANALYSIS_NOT_FOUND"
        self.message = msg
        self.details: dict[str, Any] = {"analysis_id": id_str}


class InMemoryAnalysisStore:
    """UUID をキーとして直近 max_items 件の AnalysisResponse を保持するスレッドセーフ LRU ストア。"""

    def __init__(self, max_items: int = 50) -> None:
        if max_items < 1:
            raise ValueError("max_items は 1 以上で指定してください。")
        self._max_items = int(max_items)
        self._data: OrderedDict[str, AnalysisResponse] = OrderedDict()
        self._lock = threading.RLock()

    @property
    def max_items(self) -> int:
        return self._max_items

    def save(self, response: AnalysisResponse) -> None:
        """解析結果を保存し、上限超過時は最古のエントリを破棄する。"""
        key = str(response.analysis_id)
        with self._lock:
            if key in self._data:
                self._data.move_to_end(key)
            self._data[key] = response
            while len(self._data) > self._max_items:
                self._data.popitem(last=False)

    def get(self, analysis_id: str | UUID) -> AnalysisResponse | None:
        """analysis_id に対応する解析結果を取得する（未存在時は None）。"""
        key = str(analysis_id)
        with self._lock:
            res = self._data.get(key)
            if res is not None:
                self._data.move_to_end(key)
            return res

    def exists(self, analysis_id: str | UUID) -> bool:
        """analysis_id が保持されているか判定する。"""
        key = str(analysis_id)
        with self._lock:
            return key in self._data

    def clear(self) -> None:
        """保持中の全解析結果をクリアする。"""
        with self._lock:
            self._data.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)
