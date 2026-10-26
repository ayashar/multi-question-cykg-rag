"""Declared alert graph schema, including valid relationships not yet observed."""
RELATIONSHIPS = [
    ('Host', 'HAS_ALERT', 'Alert'), ('IP', 'ATTACK_TO', 'Alert'),
    ('Alert', 'CONNECTS_TO', 'IP'), ('Alert', 'TARGETS_USER', 'User'),
    ('Alert', 'TRIGGERS', 'MitreTechnique'), ('Chunk', 'PART_OF', 'Document'),
] + [('Chunk', 'HAS_ENTITY', label) for label in ('Host', 'IP', 'User', 'MitreTechnique')]

SCHEMA_TEXT = '''Declared ingestion schema (a valid relationship may have zero rows):
Host(id), IP(id), User(id), MitreTechnique(id,tactic), Document(fileName,timestamp),
Chunk(id,text,timestamp,embedding), Alert(id,title,rule_id,rule_level,timestamp,full_log,scenario_id).
Alert.timestamp and Chunk.timestamp are UTC ISO-8601 strings.
There are no adjudication, authorization, reputation, or resolved-as-benign fields.
''' + '\n'.join(f'({left})-[:{rel}]->({right})' for left, rel, right in RELATIONSHIPS)
