package claude

import (
	"encoding/json"
	"testing"

	"one-api/types"
)

func TestClaudeStreamToolCallsUseSequentialIndexes(t *testing.T) {
	handler := &ClaudeStreamHandler{Usage: &types.Usage{}, Request: &types.ChatCompletionRequest{Model: "claude"}, Prefix: "data: "}
	lines := []string{
		`data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_a","name":"get_canvas","input":{}}}`,
		`data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}`,
		`data: {"type":"content_block_stop","index":1}`,
		`data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"call_b","name":"get_task_status","input":{}}}`,
		`data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"taskId\":\"t\"}"}}`,
	}
	dataChan := make(chan string, 16)
	errChan := make(chan error, 16)
	for _, line := range lines {
		raw := []byte(line)
		handler.HandlerStream(&raw, dataChan, errChan)
	}
	close(dataChan)
	ids := map[int]string{}
	args := map[int]string{}
	for data := range dataChan {
		var chunk types.ChatCompletionStreamResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			t.Fatal(err)
		}
		for _, call := range chunk.Choices[0].Delta.ToolCalls {
			if call.Id != "" {
				if previous, ok := ids[call.Index]; ok && previous != call.Id {
					t.Fatalf("工具调用 %s 与 %s 共用 index %d", previous, call.Id, call.Index)
				}
				ids[call.Index] = call.Id
			}
			args[call.Index] += call.Function.Arguments
		}
	}
	if ids[0] != "call_a" || ids[1] != "call_b" {
		t.Fatalf("ids = %v", ids)
	}
	if args[0] != "{}" || args[1] != `{"taskId":"t"}` {
		t.Fatalf("args = %v", args)
	}
}

func TestParallelToolCallsFalseDisablesClaudeParallelToolUse(t *testing.T) {
	var request types.ChatCompletionRequest
	if err := json.Unmarshal([]byte(`{"model":"claude-x","max_tokens":100,"messages":[{"role":"user","content":"hi"}],"tools":[{"type":"function","function":{"name":"get_canvas","parameters":{"type":"object"}}}],"parallel_tool_calls":false}`), &request); err != nil {
		t.Fatal(err)
	}
	// 中继会把请求重新序列化给上游，false 不能被 omitempty 丢掉
	raw, _ := json.Marshal(request)
	var echoed map[string]any
	_ = json.Unmarshal(raw, &echoed)
	if echoed["parallel_tool_calls"] != false {
		t.Fatalf("parallel_tool_calls = %v", echoed["parallel_tool_calls"])
	}
	claudeRequest, errWithCode := ConvertFromChatOpenai(&request)
	if errWithCode != nil {
		t.Fatal(errWithCode)
	}
	if claudeRequest.ToolChoice == nil || claudeRequest.ToolChoice.Type != "auto" || !claudeRequest.ToolChoice.DisableParallelToolUse {
		t.Fatalf("tool_choice = %+v", claudeRequest.ToolChoice)
	}

	request.ParallelToolCalls = nil
	claudeRequest, errWithCode = ConvertFromChatOpenai(&request)
	if errWithCode != nil {
		t.Fatal(errWithCode)
	}
	if claudeRequest.ToolChoice != nil {
		t.Fatalf("未指定时不应设置 tool_choice: %+v", claudeRequest.ToolChoice)
	}
}
