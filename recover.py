import json
import os

transcript_path = r"C:\Users\krish_wq7qnor\.gemini\antigravity-ide\brain\c9753b26-57e1-45f3-aaf8-c590f4c09f66\.system_generated\logs\transcript_full.jsonl"
workspace_dir = r"c:\Users\krish_wq7qnor\Downloads\New folder (5)\khaan-netra"

file_states = {}

def normalize_path(p):
    # Normalize paths to lowercase to avoid case/slash mismatches
    return os.path.normpath(p).lower()

with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            step = json.loads(line)
        except:
            continue
            
        # We only care about MODEL tool calls
        if step.get("source") == "MODEL" and "tool_calls" in step:
            for tool in step["tool_calls"]:
                name = tool.get("name")
                args = tool.get("args", {})
                
                if name == "write_to_file":
                    target = args.get("TargetFile", "")
                    if target:
                        norm_target = normalize_path(target)
                        file_states[norm_target] = args.get("CodeContent", "")
                
                elif name == "replace_file_content":
                    target = args.get("TargetFile", "")
                    if target:
                        norm_target = normalize_path(target)
                        content = file_states.get(norm_target, "")
                        lines = content.split('\n')
                        start = int(args.get("StartLine", 1)) - 1
                        end = int(args.get("EndLine", 1))
                        replacement = args.get("ReplacementContent", "").split('\n')
                        lines[start:end] = replacement
                        file_states[norm_target] = '\n'.join(lines)
                
                elif name == "multi_replace_file_content":
                    target = args.get("TargetFile", "")
                    if target:
                        norm_target = normalize_path(target)
                        content = file_states.get(norm_target, "")
                        lines = content.split('\n')
                        chunks = args.get("ReplacementChunks", [])
                        if isinstance(chunks, str):
                            try:
                                chunks = json.loads(chunks)
                            except:
                                chunks = []
                        # Sort chunks in reverse order by StartLine to avoid shifting issues
                        chunks.sort(key=lambda x: int(x.get("StartLine", 1)), reverse=True)
                        for chunk in chunks:
                            start = int(chunk.get("StartLine", 1)) - 1
                            end = int(chunk.get("EndLine", 1))
                            replacement = chunk.get("ReplacementContent", "").split('\n')
                            lines[start:end] = replacement
                        file_states[norm_target] = '\n'.join(lines)
                
                # Stop processing if this was my disastrous python script
                elif name == "run_command":
                    cmd = args.get("CommandLine", "")
                    if 'import glob; files = glob.glob(' in cmd:
                        print("Found disaster command, stopping replay.")
                        break
                        
            # Check if we should break out of outer loop
            if step.get("source") == "MODEL" and "tool_calls" in step:
                for tool in step["tool_calls"]:
                    if tool.get("name") == "run_command" and 'import glob; files = glob.glob(' in tool.get("args", {}).get("CommandLine", ""):
                        break

# Now write out the recovered files
recovered_count = 0
for norm_path, content in file_states.items():
    if workspace_dir.lower() in norm_path:
        # We need the real case-sensitive path if possible, but since we're on Windows, 
        # we can just write to the original string. Wait, we lost the original string case.
        # Let's rebuild the path based on workspace_dir.
        rel_path = norm_path.replace(workspace_dir.lower(), "").lstrip("\\/")
        actual_path = os.path.join(workspace_dir, rel_path)
        
        # Only recover the files that were truncated
        if actual_path.endswith('.js') or actual_path.endswith('.html') or actual_path.endswith('.json'):
            print(f"Recovering {actual_path}...")
            os.makedirs(os.path.dirname(actual_path), exist_ok=True)
            # Apply the em-dash replacement that the user wanted!
            content = content.replace('—', '-')
            with open(actual_path, 'w', encoding='utf-8') as out:
                out.write(content)
            recovered_count += 1

print(f"Recovered {recovered_count} files!")
