param([string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$rootPath = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$documents = @(Get-ChildItem -LiteralPath $rootPath -Recurse -File -Filter '*.md' | Where-Object { $_.FullName -notmatch '[\\/]\.git[\\/]' })
$problems = New-Object 'System.Collections.Generic.List[string]'
$checkedLinks = 0
foreach ($document in $documents) {
    $content = [IO.File]::ReadAllText($document.FullName, [Text.Encoding]::UTF8)
    foreach ($match in [regex]::Matches($content, '\[[^\]]*\]\((?<target>[^)]+)\)')) {
        $target = $match.Groups['target'].Value.Trim('<','>')
        if ($target -match '^[a-zA-Z][a-zA-Z0-9+.-]*:' -or $target.StartsWith('#')) { continue }
        $targetPath = [Uri]::UnescapeDataString(($target -split '#',2)[0])
        $resolvedTarget = Join-Path $document.DirectoryName $targetPath
        $checkedLinks++
        if (-not (Test-Path -LiteralPath $resolvedTarget)) { $problems.Add("Broken link: $($document.FullName) -> $target") }
    }
}
$logicDirectory = Join-Path $rootPath '01-信息图形数据逻辑'
$logicDocuments = @(Get-ChildItem -LiteralPath $logicDirectory -File)
if ($logicDocuments.Count -ne 5) { $problems.Add('01 must contain exactly five files.') }
foreach ($document in $logicDocuments) {
    $content = [IO.File]::ReadAllText($document.FullName, [Text.Encoding]::UTF8)
    foreach ($section in @('A','B','C','D','E')) {
        if ($content -notmatch "(?m)^## $section ") { $problems.Add("Missing section $section in $($document.Name)") }
    }
    if ($content -match '!\[' -or $document.Extension -ne '.md') { $problems.Add("Image or non-Markdown file in 01: $($document.Name)") }
    if ($content -notmatch '\.\./02-信息图形类型案例/') { $problems.Add("Missing case link in $($document.Name)") }
}
$rules = @(Get-ChildItem -LiteralPath (Join-Path $rootPath '04-Gestalt视觉组织原则/01-规则定义') -File -Filter '*.md')
if ($rules.Count -ne 13) { $problems.Add('Gestalt working catalogue must contain 13 entries.') }
$stages = @(Get-ChildItem -LiteralPath (Join-Path $rootPath '06-XXX主题信息图形设计') -Directory)
if ($stages.Count -ne 8) { $problems.Add('Theme workspace must contain eight stage directories.') }
if (-not (Test-Path -LiteralPath (Join-Path $rootPath '02-信息图形类型案例/18-ISOTYPE-基础图形设计方法/00-标签说明.md'))) { $problems.Add('ISOTYPE method tag is missing.') }
$caseRoot = Join-Path $rootPath '02-信息图形类型案例'
$tagDirectories = @(Get-ChildItem -LiteralPath $caseRoot -Directory)
if ($tagDirectories.Count -ne 18) { $problems.Add('02 must contain exactly 18 direct tag directories.') }
foreach ($number in 1..18) {
    $prefix = '{0:D2}-' -f $number
    $matches = @($tagDirectories | Where-Object { $_.Name.StartsWith($prefix) })
    if ($matches.Count -ne 1) { $problems.Add("Missing or repeated tag number: $prefix"); continue }
    foreach ($requiredFile in @('00-标签说明.md', '案例/README.md')) {
        if (-not (Test-Path -LiteralPath (Join-Path $matches[0].FullName $requiredFile))) { $problems.Add("Missing $requiredFile in $($matches[0].Name)") }
    }
}
$isotypeRoot = Join-Path $rootPath '03-ISOTYPE信息图'
$isotypeDirectories = @()
if (-not (Test-Path -LiteralPath $isotypeRoot)) {
    $problems.Add('03 ISOTYPE topic directory is missing.')
} else {
    $isotypeDirectories = @(Get-ChildItem -LiteralPath $isotypeRoot -Directory)
    if ($isotypeDirectories.Count -ne 4) { $problems.Add('03 must contain exactly four topic subdirectories.') }
    foreach ($topicName in @('01-历史与文献','02-图符语言与视觉编码','03-案例研究','04-设计实践')) {
        if (-not (Test-Path -LiteralPath (Join-Path $isotypeRoot ($topicName + '/README.md')))) { $problems.Add("Missing ISOTYPE topic: $topicName") }
    }
    foreach ($rootDocument in @('README.md','00-ISOTYPE概念与方法.md')) {
        if (-not (Test-Path -LiteralPath (Join-Path $isotypeRoot $rootDocument))) { $problems.Add("Missing ISOTYPE root document: $rootDocument") }
    }
}
$summary = [ordered]@{ markdown_files=$documents.Count; local_links=$checkedLinks; logic_definitions=$logicDocuments.Count; case_tag_directories=$tagDirectories.Count; isotype_subdirectories=$isotypeDirectories.Count; gestalt_entries=$rules.Count; project_stages=$stages.Count; errors=$problems.Count; details=@($problems.ToArray()) }
$summary | ConvertTo-Json -Depth 4
if ($problems.Count -gt 0) { exit 1 }
