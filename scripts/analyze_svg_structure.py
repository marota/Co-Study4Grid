import sys
import os
import json
import xml.etree.ElementTree as ET
from pathlib import Path

def analyze_svg(svg_path):
    if not os.path.exists(svg_path):
        print(f"Error: {svg_path} does not exist.")
        return

    print(f"\n--- SVG Analysis: {svg_path} ({os.path.getsize(svg_path) / 1024 / 1024:.2f} MB) ---")
    
    try:
        tree = ET.parse(svg_path)
    except ET.ParseError as e:
        print(f"Parse Error: {e}")
        return
    
    root = tree.getroot()
    tag_counts = {}
    attr_sizes = {}
    
    for el in root.iter():
        tag = el.tag.split('}')[-1]
        tag_counts[tag] = tag_counts.get(tag, 0) + 1
        for name, value in el.attrib.items():
            attr = name.split('}')[-1]
            attr_sizes[attr] = attr_sizes.get(attr, 0) + len(value)

    print("\nTop 10 Element Counts:")
    for tag, count in sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:10]:
        print(f"  {tag:15}: {count}")

    print("\nTop 10 Attribute Sizes:")
    for attr, size in sorted(attr_sizes.items(), key=lambda x: x[1], reverse=True)[:10]:
        print(f"  {attr:15}: {size / 1024 / 1024:.2f} MB")

def analyze_metadata(meta_path):
    if not os.path.exists(meta_path):
        print(f"Error: {meta_path} does not exist.")
        return

    print(f"\n--- Metadata Analysis: {meta_path} ---")
    
    with open(meta_path, 'r') as f:
        raw_data = json.load(f)
    
    if isinstance(raw_data, str):
        # Handle double-encoded JSON if necessary
        try:
            data = json.loads(raw_data)
        except:
            data = raw_data
    else:
        data = raw_data

    if not isinstance(data, dict):
        print(f"Metadata is type {type(data)}, not a dictionary.")
        return

    # Analyze top level keys
    print("\nTop Level Categories:")
    for key, value in data.items():
        if isinstance(value, list):
            size = len(json.dumps(value)) / 1024 / 1024
            print(f"  {key:<20}: {len(value):>6} items, {size:>6.2f} MB")
        else:
            size = len(json.dumps(value)) / 1024 / 1024
            print(f"  {key:<20}: {'(object)':>6}, {size:>6.2f} MB")

    # Detailed field analysis for lists
    for key, items in data.items():
        if isinstance(items, list) and len(items) > 0:
            print(f"\nField Breakdown for '{key}':")
            field_stats = {}
            for item in items:
                if isinstance(item, dict):
                    for f_key, f_val in item.items():
                        if f_key not in field_stats:
                            field_stats[f_key] = {"count": 0, "size": 0}
                        field_stats[f_key]["count"] += 1
                        field_stats[f_key]["size"] += len(str(f_val))
            
            print(f"  {'Field':<25} | {'Count':>8} | {'Total Size':>12}")
            print("-" * 55)
            for f_key, stats in sorted(field_stats.items(), key=lambda x: x[1]["size"], reverse=True):
                print(f"  {f_key:<25} | {stats['count']:>8} | {stats['size'] / 1024 / 1024:>10.2f} MB")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python analyze_svg_structure.py <svg_path> <metadata_path>")
    else:
        analyze_svg(sys.argv[1])
        analyze_metadata(sys.argv[2])
