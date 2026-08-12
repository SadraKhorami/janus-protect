<?php

declare(strict_types=1);

use PhpParser\Error;
use PhpParser\Node;
use PhpParser\NodeTraverser;
use PhpParser\NodeVisitor\NameResolver;
use PhpParser\ParserFactory;

require dirname(__DIR__) . '/vendor/autoload.php';

$raw = stream_get_contents(STDIN);
$input = json_decode($raw ?: '', true, flags: JSON_THROW_ON_ERROR);
$parser = (new ParserFactory())->createForNewestSupportedVersion();
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

    $tokens = token_get_all($source, TOKEN_PARSE);
    $transformed = '';
    foreach ($tokens as $token) {
        if (is_array($token)) {
            if ($token[0] === T_COMMENT) {
                continue;
            }
            $transformed .= $token[1];
        } else {
            $transformed .= $token;
        }
    }

    $analysis['phpFiles']++;
    $output[] = ['path' => $path, 'content' => base64_encode($transformed)];
}

foreach (['namespaces', 'classes', 'interfaces', 'traits', 'functions'] as $key) {
    $analysis[$key] = array_values(array_unique($analysis[$key]));
    sort($analysis[$key]);
}

fwrite(STDOUT, json_encode(['files' => $output, 'analysis' => $analysis], JSON_THROW_ON_ERROR));

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
