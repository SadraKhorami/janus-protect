<?php

declare(strict_types=1);

use PhpParser\Error;
use PhpParser\Node;
use PhpParser\NodeTraverser;
use PhpParser\NodeVisitor\NameResolver;
use PhpParser\NodeVisitorAbstract;
use PhpParser\ParserFactory;
use PhpParser\PrettyPrinter\Standard;

require dirname(__DIR__) . '/vendor/autoload.php';

function main(): void
{
$raw = stream_get_contents(STDIN);
$input = json_decode($raw ?: '', true, flags: JSON_THROW_ON_ERROR);
$parser = (new ParserFactory())->createForNewestSupportedVersion();
$printer = new Standard();
$obfuscate = (bool) ($input['obfuscate'] ?? false);
$output = [];
$analysis = [
    'phpFiles' => 0,
    'namespaces' => [],
    'classes' => [],
    'interfaces' => [],
    'traits' => [],
    'functions' => [],
    'methods' => 0,
    'parseErrors' => [],
    'renamedVariables' => 0,
    'obfuscatedFiles' => 0,
];

foreach (($input['files'] ?? []) as $file) {
    $path = (string) ($file['path'] ?? '');
    $source = base64_decode((string) ($file['content'] ?? ''), true);
    if (!is_string($source)) {
        throw new RuntimeException("Invalid base64 source for {$path}");
    }

    try {
        $statements = $parser->parse($source);
        $traverser = new NodeTraverser();
        $traverser->addVisitor(new NameResolver());
        $statements = $traverser->traverse($statements ?? []);
        collect_symbols($statements, $analysis);
    } catch (Error $error) {
        $analysis['parseErrors'][] = ['path' => $path, 'message' => $error->getMessage()];
        continue;
    }

    if ($obfuscate) {
        $obfuscator = new LocalVariableObfuscator($path, collect_reserved_variables($statements));
        $obfuscationTraverser = new NodeTraverser();
        $obfuscationTraverser->addVisitor($obfuscator);
        $statements = $obfuscationTraverser->traverse($statements);
        $transformed = $printer->prettyPrintFile($statements) . "\n";
        $analysis['renamedVariables'] += $obfuscator->renamedCount();
        if ($obfuscator->renamedCount() > 0) {
            $analysis['obfuscatedFiles']++;
        }
    } else {
        $transformed = strip_comments($source);
    }

    $analysis['phpFiles']++;
    $output[] = ['path' => $path, 'content' => base64_encode($transformed)];
}

foreach (['namespaces', 'classes', 'interfaces', 'traits', 'functions'] as $key) {
    $analysis[$key] = array_values(array_unique($analysis[$key]));
    sort($analysis[$key]);
}

fwrite(STDOUT, json_encode(['files' => $output, 'analysis' => $analysis], JSON_THROW_ON_ERROR));
}

final class LocalVariableObfuscator extends NodeVisitorAbstract
{
    /** @var list<array<string, string>> */
    private array $scopes = [];
    private int $renamed = 0;

    /** @param array<string, true> $reserved */
    public function __construct(private readonly string $path, private readonly array $reserved)
    {
    }

    public function enterNode(Node $node): ?Node
    {
        if (is_function_scope($node)) {
            $this->scopes[] = [];
        }
        if ($this->scopes === [] || !$node instanceof Node\Expr\Variable || !is_string($node->name)) {
            return null;
        }
        $name = $node->name;
        if (isset($this->reserved[$name])) {
            return null;
        }
        $scopeIndex = array_key_last($this->scopes);
        $mapped = $this->scopes[$scopeIndex][$name] ?? null;
        if ($mapped === null) {
            $mapped = '__jp_' . substr(hash('sha256', $this->path . ':' . $scopeIndex . ':' . $name), 0, 12);
            $this->scopes[$scopeIndex][$name] = $mapped;
            $this->renamed++;
        }
        $node->name = $mapped;
        return $node;
    }

    public function leaveNode(Node $node): ?Node
    {
        if (is_function_scope($node)) {
            array_pop($this->scopes);
        }
        return null;
    }

    public function renamedCount(): int
    {
        return $this->renamed;
    }
}

function is_function_scope(Node $node): bool
{
    return $node instanceof Node\Stmt\Function_
        || $node instanceof Node\Stmt\ClassMethod
        || $node instanceof Node\Expr\Closure;
}

/** @param list<Node\Stmt> $statements @return array<string, true> */
function collect_reserved_variables(array $statements): array
{
    $reserved = array_fill_keys([
        'this', 'GLOBALS', '_SERVER', '_GET', '_POST', '_FILES', '_COOKIE', '_SESSION', '_REQUEST', '_ENV',
    ], true);
    $walk = static function (array $nodes) use (&$walk, &$reserved): void {
        foreach ($nodes as $node) {
            if (!$node instanceof Node) {
                continue;
            }
            if ($node instanceof Node\Param && is_string($node->var->name)) {
                $reserved[$node->var->name] = true;
            } elseif ($node instanceof Node\Expr\ClosureUse && is_string($node->var->name)) {
                $reserved[$node->var->name] = true;
            } elseif ($node instanceof Node\Stmt\Global_) {
                foreach ($node->vars as $variable) {
                    if (is_string($variable->name)) {
                        $reserved[$variable->name] = true;
                    }
                }
            } elseif ($node instanceof Node\Expr\ArrowFunction || ($node instanceof Node\Expr\Variable && !is_string($node->name))) {
                reserve_variables_in_node($node, $reserved);
            } elseif ($node instanceof Node\Scalar\String_) {
                $reserved[$node->value] = true;
            }
            $walk(child_nodes($node));
        }
    };
    $walk($statements);
    if (contains_dynamic_variable_features($statements)) {
        foreach ($statements as $statement) {
            reserve_variables_in_node($statement, $reserved);
        }
    }
    return $reserved;
}

/** @param list<Node> $nodes */
function contains_dynamic_variable_features(array $nodes): bool
{
    foreach ($nodes as $node) {
        if ($node instanceof Node\Expr\Variable && !is_string($node->name)) {
            return true;
        }
        if ($node instanceof Node\Expr\FuncCall && $node->name instanceof Node\Name) {
            $name = strtolower($node->name->toString());
            if (in_array($name, ['extract', 'get_defined_vars', 'import_request_variables', 'parse_str', 'mb_parse_str'], true)) {
                return true;
            }
        }
        if (contains_dynamic_variable_features(child_nodes($node))) {
            return true;
        }
    }
    return false;
}

/** @param array<string, true> $reserved */
function reserve_variables_in_node(Node $node, array &$reserved): void
{
    if ($node instanceof Node\Expr\Variable && is_string($node->name)) {
        $reserved[$node->name] = true;
    }
    foreach (child_nodes($node) as $child) {
        reserve_variables_in_node($child, $reserved);
    }
}

function strip_comments(string $source): string
{
    $transformed = '';
    foreach (token_get_all($source, TOKEN_PARSE) as $token) {
        if (is_array($token)) {
            if ($token[0] !== T_COMMENT) {
                $transformed .= $token[1];
            }
        } else {
            $transformed .= $token;
        }
    }
    return $transformed;
}

/** @param array<string, mixed> $analysis */
function collect_symbols(array $nodes, array &$analysis): void
{
    foreach ($nodes as $node) {
        if (!$node instanceof Node) {
            continue;
        }
        if ($node instanceof Node\Stmt\Namespace_ && $node->name !== null) {
            $analysis['namespaces'][] = $node->name->toString();
        } elseif ($node instanceof Node\Stmt\Class_ && $node->name !== null) {
            $analysis['classes'][] = resolved_name($node);
        } elseif ($node instanceof Node\Stmt\Interface_ && $node->name !== null) {
            $analysis['interfaces'][] = resolved_name($node);
        } elseif ($node instanceof Node\Stmt\Trait_ && $node->name !== null) {
            $analysis['traits'][] = resolved_name($node);
        } elseif ($node instanceof Node\Stmt\Function_) {
            $analysis['functions'][] = resolved_name($node);
        } elseif ($node instanceof Node\Stmt\ClassMethod) {
            $analysis['methods']++;
        }
        collect_symbols($node->getSubNodeNames() === [] ? [] : child_nodes($node), $analysis);
    }
}

/** @return list<Node> */
function child_nodes(Node $node): array
{
    $children = [];
    foreach ($node->getSubNodeNames() as $name) {
        $value = $node->{$name};
        if ($value instanceof Node) {
            $children[] = $value;
        } elseif (is_array($value)) {
            foreach ($value as $child) {
                if ($child instanceof Node) {
                    $children[] = $child;
                }
            }
        }
    }
    return $children;
}

function resolved_name(Node $node): string
{
    $namespaced = $node->getAttribute('namespacedName');
    if ($namespaced instanceof Node\Name) {
        return $namespaced->toString();
    }
    $name = $node->name ?? null;
    return $name instanceof Node\Identifier ? $name->toString() : '';
}

main();
