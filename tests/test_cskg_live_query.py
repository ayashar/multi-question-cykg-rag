import json
import unittest
from unittest.mock import patch

from src.agents.mcp_rdf_agent import (
    _publish_live_sparql_queries,
    _sparql_queries,
    _sparql_query_from_log_message,
)


QUERY = "PREFIX attack: <http://w3id.org/sepses/vocab/ref/attack#>\nSELECT ?technique WHERE { ?technique ?p ?o }"


class CskgLiveQueryTests(unittest.TestCase):
    def test_extracts_new_single_line_json_query(self) -> None:
        message = f"[SPARQL query] {json.dumps(QUERY)}"
        self.assertEqual(_sparql_query_from_log_message(message), QUERY)

    def test_keeps_legacy_multiline_query_compatible(self) -> None:
        message = f"[SPARQL query]\n{QUERY}"
        self.assertEqual(_sparql_query_from_log_message(message), QUERY)

    def test_live_event_contains_the_full_query(self) -> None:
        message = f"[SPARQL query] {json.dumps(QUERY)}"
        with patch("src.agents.mcp_rdf_agent._record_trace_event") as record:
            _publish_live_sparql_queries([{"message": message}])

        record.assert_called_once_with(
            "sparql_query",
            "SPARQL query started",
            query=QUERY,
            status="running",
        )

    def test_completed_trace_uses_the_same_decoder(self) -> None:
        message = f"[SPARQL query] {json.dumps(QUERY)}"
        self.assertEqual(_sparql_queries([{"ts": 123, "message": message}]), [{"ts": 123, "query": QUERY}])


if __name__ == "__main__":
    unittest.main()
