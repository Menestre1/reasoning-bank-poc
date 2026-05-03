#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Извлекает из текстового файла (модуля 1С) процедуры/функции,
содержащие комментарии с заданными маркерами (по умолчанию AVS, Космачев).
Результат сохраняется в выходной файл.
"""

import re
import os
import sys
import argparse
import chardet

def detect_encoding(file_path):
    """Автоматически определяет кодировку файла"""
    try:
        with open(file_path, 'rb') as f:
            raw_data = f.read(10240)
        result = chardet.detect(raw_data)
        encoding = result['encoding']
        confidence = result['confidence']

        if not encoding or confidence < 0.5:
            encoding = 'utf-8'

        encoding = encoding.lower()
        if encoding == 'windows-1251':
            encoding = 'cp1251'
        elif encoding == 'windows-1252':
            encoding = 'cp1252'

        print(f"  Определена кодировка: {encoding} (уверенность: {confidence:.2%})", file=sys.stderr)
        return encoding

    except Exception as e:
        print(f"  Ошибка при определении кодировки: {e}, использую utf-8", file=sys.stderr)
        return 'utf-8'

def read_file_with_encoding(file_path):
    """Читает файл с автоматически определенной кодировкой"""
    encoding = detect_encoding(file_path)

    try:
        with open(file_path, 'r', encoding=encoding, errors='replace') as f:
            return f.read(), encoding
    except Exception as e:
        print(f"  Ошибка при чтении файла: {e}", file=sys.stderr)
        for alt_enc in ['utf-8', 'cp1251', 'cp866', 'koi8-r']:
            try:
                with open(file_path, 'r', encoding=alt_enc, errors='replace') as f:
                    print(f"  Файл прочитан с альтернативной кодировкой: {alt_enc}", file=sys.stderr)
                    return f.read(), alt_enc
            except:
                continue
        raise Exception("Не удалось прочитать файл")

def find_procedures_with_markers(code, markers):
    """
    Находит подпрограммы (Функция/Процедура), у которых есть комментарий,
    содержащий любой из маркеров (перед подпрограммой или внутри её тела).
    Возвращает список кортежей (начало, конец, имя, тип, причина)
    """
    lines = code.split('\n')
    total_lines = len(lines)
    i = 0
    found = []

    pattern = re.compile('|'.join(f'(?i:{re.escape(m)})' for m in markers))

    while i < total_lines:
        line = lines[i]
        stripped = line.strip()

        proc_match = re.search(r'^\s*(?:Функция|Процедура)\s+(\w+)', line)
        if proc_match:
            proc_name = proc_match.group(1)
            proc_type = 'Функция' if 'Функция' in line else 'Процедура'
            start_idx = i

            has_before = False
            for j in range(max(0, i - 5), i):
                if pattern.search(lines[j]):
                    has_before = True
                    break

            j = i + 1
            while j < total_lines:
                if ('КонецФункции' in lines[j] and proc_type == 'Функция') or \
                   ('КонецПроцедуры' in lines[j] and proc_type == 'Процедура'):
                    end_idx = j
                    break
                j += 1
            else:
                i += 1
                continue

            has_inside = False
            for k in range(start_idx, end_idx + 1):
                if pattern.search(lines[k]):
                    has_inside = True
                    break

            if has_before or has_inside:
                reason = []
                if has_before:
                    reason.append("комментарий перед")
                if has_inside:
                    reason.append("комментарий внутри")
                found.append((start_idx, end_idx, proc_name, proc_type, ", ".join(reason)))
                i = end_idx + 1
            else:
                i = end_idx + 1
        else:
            i += 1

    return found

def extract_procedures(code, procedures_info):
    """Извлекает найденные подпрограммы в виде списка строк"""
    lines = code.split('\n')
    extracted = []
    for start, end, name, proc_type, reason in procedures_info:
        extracted.append(f"// === {proc_type} {name} (сохранена: {reason}) ===\n")
        for line in lines[start:end+1]:
            extracted.append(line + '\n')
        extracted.append("\n")
    return extracted

def main():
    parser = argparse.ArgumentParser(description='Извлечение процедур/функций с маркерами комментариев')
    parser.add_argument('--input', '-i', required=True, help='Входной файл (модуль 1С)')
    parser.add_argument('--output', '-o', default='2.txt', help='Выходной файл')
    parser.add_argument('--markers', '-m', nargs='+', default=['AVS', 'Космачев'],
                        help='Список маркеров (по умолчанию: AVS Космачев)')
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"ОШИБКА: Файл '{args.input}' не найден!", file=sys.stderr)
        sys.exit(1)

    try:
        code, enc = read_file_with_encoding(args.input)
        if not code.strip():
            print("Файл пуст", file=sys.stderr)
            sys.exit(0)

        procedures = find_procedures_with_markers(code, args.markers)
        if not procedures:
            print("НЕ НАЙДЕНО подпрограмм с маркерами.", file=sys.stderr)
            with open(args.output, 'w', encoding='utf-8') as f:
                f.write("")
        else:
            extracted = extract_procedures(code, procedures)
            with open(args.output, 'w', encoding='utf-8') as f:
                f.write(f"// Файл создан автоматически\n")
                f.write(f"// Содержит подпрограммы с маркерами: {', '.join(args.markers)}\n")
                f.write(f"// Найдено подпрограмм: {len(procedures)}\n")
                f.write(f"// Исходная кодировка: {enc}\n")
                f.write("// " + "=" * 66 + "\n\n")
                f.writelines(extracted)

        print(f"Сохранено процедур: {len(procedures)}")
        print(f"Выходной файл: {args.output}")

    except Exception as e:
        print(f"ОШИБКА: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
