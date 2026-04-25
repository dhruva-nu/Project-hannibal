from typing import Generic, Protocol, TypeVar

T = TypeVar("T")


class Repository(Protocol, Generic[T]):
    def get(self) -> T: ...
