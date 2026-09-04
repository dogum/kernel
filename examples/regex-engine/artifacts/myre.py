"""A small regex engine: tokenizer, parser, Thompson NFA, and lazy DFA."""
from dataclasses import dataclass
from typing import Any


class RegexError(ValueError):
    pass


@dataclass(frozen=True)
class Token:
    kind: str
    value: Any = None
    pos: int = 0


@dataclass(frozen=True)
class Node:
    kind: str
    value: Any = None
    children: tuple = ()


@dataclass(frozen=True)
class ClassSpec:
    singles: frozenset
    ranges: tuple
    negated: bool = False

    def matches(self, ch):
        inside = ch in self.singles or any(lo <= ch <= hi for lo, hi in self.ranges)
        return not inside if self.negated else inside


_ESCAPE_MAP = {"n": "\n", "t": "\t", "r": "\r", "f": "\f", "v": "\v", "a": "\a"}
_META = set(".*+?|()[]^$\\")


def _escaped(pattern, index):
    if index + 1 >= len(pattern):
        raise RegexError(f"trailing backslash at position {index}")
    code = pattern[index + 1]
    if code in _ESCAPE_MAP:
        return _ESCAPE_MAP[code], index + 2
    if code.isalnum():
        raise RegexError(f"unsupported escape \\{code} at position {index}")
    return code, index + 2


def _class_token(pattern, start):
    i = start + 1
    negated = i < len(pattern) and pattern[i] == "^"
    if negated:
        i += 1
    raw = []
    first = True
    while i < len(pattern):
        if pattern[i] == "]" and not first:
            break
        if pattern[i] == "\\":
            ch, i = _escaped(pattern, i)
            raw.append((ch, True))
        else:
            raw.append((pattern[i], False))
            i += 1
        first = False
    if i >= len(pattern) or pattern[i] != "]":
        raise RegexError(f"unterminated character class at position {start}")
    if not raw:
        raise RegexError(f"empty character class at position {start}")
    singles, ranges = set(), []
    j = 0
    while j < len(raw):
        if j + 2 < len(raw) and raw[j + 1] == ("-", False):
            lo, hi = raw[j][0], raw[j + 2][0]
            if ord(lo) > ord(hi):
                raise RegexError(f"descending range {lo}-{hi}")
            ranges.append((lo, hi))
            j += 3
        else:
            singles.add(raw[j][0])
            j += 1
    return Token("CLASS", ClassSpec(frozenset(singles), tuple(ranges), negated), start), i + 1


def tokenize(pattern):
    tokens = []
    single = {".": "DOT", "*": "STAR", "+": "PLUS", "?": "QMARK",
              "|": "ALT", "(": "LPAREN", ")": "RPAREN", "^": "BOL", "$": "EOL"}
    i = 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == "\\":
            value, i = _escaped(pattern, i)
            tokens.append(Token("LIT", value, i - 2))
        elif ch == "[":
            token, i = _class_token(pattern, i)
            tokens.append(token)
        elif ch in single:
            tokens.append(Token(single[ch], None, i))
            i += 1
        else:
            tokens.append(Token("LIT", ch, i))
            i += 1
    tokens.append(Token("EOF", None, len(pattern)))
    return tokens


class Parser:
    def __init__(self, tokens):
        self.tokens = tokens
        self.index = 0

    @property
    def current(self):
        return self.tokens[self.index]

    def take(self, kind=None):
        token = self.current
        if kind is not None and token.kind != kind:
            raise RegexError(f"expected {kind}, found {token.kind} at position {token.pos}")
        self.index += 1
        return token

    def parse(self):
        node = self.alternation()
        if self.current.kind != "EOF":
            raise RegexError(f"unexpected {self.current.kind} at position {self.current.pos}")
        return node

    def alternation(self):
        branches = [self.concatenation()]
        while self.current.kind == "ALT":
            self.take("ALT")
            branches.append(self.concatenation())
        return branches[0] if len(branches) == 1 else Node("ALT", children=tuple(branches))

    def concatenation(self):
        parts = []
        while self.current.kind not in {"ALT", "RPAREN", "EOF"}:
            parts.append(self.repetition())
        if not parts:
            return Node("EMPTY")
        return parts[0] if len(parts) == 1 else Node("CONCAT", children=tuple(parts))

    def repetition(self):
        atom = self.atom()
        if self.current.kind in {"STAR", "PLUS", "QMARK"}:
            quantifier = self.take().kind
            if self.current.kind in {"STAR", "PLUS", "QMARK"}:
                raise RegexError(f"multiple repeat at position {self.current.pos}")
            return Node(quantifier, children=(atom,))
        return atom

    def atom(self):
        token = self.current
        if token.kind == "LIT":
            self.take()
            return Node("LIT", token.value)
        if token.kind == "DOT":
            self.take()
            return Node("DOT")
        if token.kind == "CLASS":
            self.take()
            return Node("CLASS", token.value)
        if token.kind == "BOL":
            self.take()
            return Node("BOL")
        if token.kind == "EOL":
            self.take()
            return Node("EOL")
        if token.kind == "LPAREN":
            opening = self.take()
            child = self.alternation()
            if self.current.kind != "RPAREN":
                raise RegexError(f"unclosed group at position {opening.pos}")
            self.take("RPAREN")
            return Node("GROUP", children=(child,))
        if token.kind == "RPAREN":
            raise RegexError(f"unmatched ')' at position {token.pos}")
        if token.kind in {"STAR", "PLUS", "QMARK"}:
            raise RegexError(f"nothing to repeat at position {token.pos}")
        raise RegexError(f"unexpected token {token.kind} at position {token.pos}")


def parse(pattern):
    return Parser(tokenize(pattern)).parse()


@dataclass
class NFA:
    transitions: list
    start: int
    accept: int


class NFABuilder:
    def __init__(self):
        self.transitions = []

    def state(self):
        index = len(self.transitions)
        self.transitions.append([])
        return index

    def edge(self, source, kind, value, target):
        self.transitions[source].append((kind, value, target))

    def build(self, node):
        kind = node.kind
        if kind in {"EMPTY", "LIT", "DOT", "CLASS", "BOL", "EOL"}:
            start, end = self.state(), self.state()
            edge_kind = "EPS" if kind == "EMPTY" else kind
            self.edge(start, edge_kind, node.value, end)
            return start, end
        if kind == "GROUP":
            return self.build(node.children[0])
        if kind == "CONCAT":
            first_start, previous_end = self.build(node.children[0])
            for child in node.children[1:]:
                child_start, child_end = self.build(child)
                self.edge(previous_end, "EPS", None, child_start)
                previous_end = child_end
            return first_start, previous_end
        if kind == "ALT":
            start, end = self.state(), self.state()
            for child in node.children:
                child_start, child_end = self.build(child)
                self.edge(start, "EPS", None, child_start)
                self.edge(child_end, "EPS", None, end)
            return start, end
        if kind in {"STAR", "PLUS", "QMARK"}:
            start, end = self.state(), self.state()
            child_start, child_end = self.build(node.children[0])
            if kind in {"STAR", "QMARK"}:
                self.edge(start, "EPS", None, end)
            self.edge(start, "EPS", None, child_start)
            if kind in {"STAR", "PLUS"}:
                self.edge(child_end, "EPS", None, child_start)
            self.edge(child_end, "EPS", None, end)
            return start, end
        raise RegexError(f"unknown AST node {kind}")


def to_nfa(ast):
    builder = NFABuilder()
    start, accept = builder.build(ast)
    return NFA(builder.transitions, start, accept)


class DFA:
    def __init__(self, nfa):
        self.nfa = nfa
        self.subsets = {}
        self.transition_cache = {}

    def _register(self, states):
        states = frozenset(states)
        if states not in self.subsets:
            self.subsets[states] = len(self.subsets)
        return states

    def _closure(self, states, position, text):
        closed = set(states)
        stack = list(states)
        while stack:
            state = stack.pop()
            for kind, value, target in self.nfa.transitions[state]:
                enabled = (kind == "EPS" or
                           (kind == "BOL" and position == 0) or
                           (kind == "EOL" and (position == len(text) or
                                               (position == len(text) - 1 and text.endswith("\n")))))
                if enabled and target not in closed:
                    closed.add(target)
                    stack.append(target)
        return self._register(closed)

    @staticmethod
    def _consumes(kind, value, ch):
        if kind == "LIT":
            return ch == value
        if kind == "DOT":
            return ch != "\n"
        if kind == "CLASS":
            return value.matches(ch)
        return False

    def _advance(self, states, ch, next_position, text):
        context = (next_position == 0, next_position == len(text),
                   next_position == len(text) - 1 and text.endswith("\n"))
        key = (states, ch, context)
        if key in self.transition_cache:
            return self.transition_cache[key]
        moved = set()
        for state in states:
            for kind, value, target in self.nfa.transitions[state]:
                if self._consumes(kind, value, ch):
                    moved.add(target)
        result = self._closure(moved, next_position, text)
        self.transition_cache[key] = result
        return result

    def fullmatch(self, text):
        if not isinstance(text, str):
            raise TypeError("text must be str")
        states = self._closure({self.nfa.start}, 0, text)
        for position, ch in enumerate(text):
            states = self._advance(states, ch, position + 1, text)
            if not states:
                return False
        states = self._closure(states, len(text), text)
        return self.nfa.accept in states

    @property
    def state_count(self):
        return len(self.subsets)


class Pattern:
    def __init__(self, source):
        if not isinstance(source, str):
            raise TypeError("pattern must be str")
        self.pattern = source
        self.ast = parse(source)
        self.nfa = to_nfa(self.ast)
        self.dfa = DFA(self.nfa)

    def fullmatch(self, text):
        return self.dfa.fullmatch(text)

    @property
    def dfa_state_count(self):
        return self.dfa.state_count


def compile(pattern):
    return Pattern(pattern)


def fullmatch(pattern, text):
    return compile(pattern).fullmatch(text)
