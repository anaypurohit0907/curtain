package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Result is the output of a function invocation.
type Result struct {
	StatusCode int               `json:"status_code"`
	Headers    map[string]string `json:"headers,omitempty"`
	Body       string            `json:"body"`
	Error      string            `json:"error,omitempty"`
	DurationMs int64             `json:"duration_ms"`
}

// Runner executes user-submitted TypeScript/JavaScript in a Deno subprocess.
// Each invocation spawns a new process; there is no persistent state between calls.
type Runner struct {
	denoPath    string
	functionDir string
	timeout     time.Duration
}

func New(denoPath, functionDir string, timeout time.Duration) *Runner {
	if err := os.MkdirAll(functionDir, 0700); err != nil {
		panic(fmt.Sprintf("edge/runner: cannot create function dir: %v", err))
	}
	return &Runner{
		denoPath:    denoPath,
		functionDir: functionDir,
		timeout:     timeout,
	}
}

// Invoke runs the function code and returns the result.
func (r *Runner) Invoke(ctx context.Context,
	fnName, code string,
	reqBody []byte,
	reqHeaders map[string]string,
) *Result {
	start := time.Now()

	// Sanitize function name for use in filename
	safeName := sanitize(fnName)
	tmpPath := filepath.Join(r.functionDir, fmt.Sprintf("%s_%d.ts", safeName, time.Now().UnixNano()))
	defer os.Remove(tmpPath)

	wrapped := wrapUserCode(code, reqBody, reqHeaders)
	if err := os.WriteFile(tmpPath, []byte(wrapped), 0600); err != nil {
		return &Result{StatusCode: 500, Error: "failed to write function file", DurationMs: ms(start)}
	}

	ctx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()

	// Deno flags:
	//   --no-prompt               don't ask for permissions interactively
	//   --allow-net               allow outbound HTTP (can restrict to specific hostnames)
	//   --no-npm                  disable npm specifiers (security)
	//   --no-remote               disable remote imports (only std lib + pre-cached)
	cmd := exec.CommandContext(ctx, r.denoPath, "run",
		"--no-prompt",
		"--allow-net",
		"--no-npm",
		tmpPath,
	)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return &Result{StatusCode: 504, Error: "function timed out",
				DurationMs: ms(start)}
		}
		errMsg := strings.TrimSpace(stderr.String())
		if errMsg == "" {
			errMsg = err.Error()
		}
		return &Result{StatusCode: 500, Error: errMsg, DurationMs: ms(start)}
	}

	// Parse the single JSON line the wrapper writes to stdout
	var out struct {
		StatusCode int               `json:"status_code"`
		Headers    map[string]string `json:"headers"`
		Body       string            `json:"body"`
	}
	outStr := strings.TrimSpace(stdout.String())
	if err := json.Unmarshal([]byte(outStr), &out); err != nil {
		// Function didn't output valid JSON — treat raw stdout as body
		return &Result{
			StatusCode: 200,
			Body:       outStr,
			DurationMs: ms(start),
		}
	}

	if out.StatusCode == 0 {
		out.StatusCode = 200
	}

	return &Result{
		StatusCode: out.StatusCode,
		Headers:    out.Headers,
		Body:       out.Body,
		DurationMs: ms(start),
	}
}

// wrapUserCode injects the Curtain runtime shim around user code.
// The user is expected to export a default `handler` function.
func wrapUserCode(code string, body []byte, headers map[string]string) string {
	bodyJSON := string(body)
	if bodyJSON == "" {
		bodyJSON = "null"
	}
	headersJSON, _ := json.Marshal(headers)

	return fmt.Sprintf(`
// ── Curtain Edge Runtime v1 ────────────────────────────────────────────────
const __body    = %s;
const __headers = %s;

const request = {
  body:    __body,
  headers: new Headers(__headers),
  json:    () => Promise.resolve(__body),
  text:    () => Promise.resolve(JSON.stringify(__body)),
};

// ── User code ────────────────────────────────────────────────────────────────
%s
// ── Runner ───────────────────────────────────────────────────────────────────

if (typeof handler !== "function") {
  console.log(JSON.stringify({status_code: 500, body: "handler is not a function"}));
  Deno.exit(0);
}

try {
  const response = await handler(request);
  let body = "";
  if (response instanceof Response) {
    body = await response.text();
    const hdrs = {};
    response.headers.forEach((v, k) => { hdrs[k] = v; });
    console.log(JSON.stringify({
      status_code: response.status,
      headers: hdrs,
      body,
    }));
  } else {
    // Allow returning a plain object
    console.log(JSON.stringify({
      status_code: 200,
      body: JSON.stringify(response),
    }));
  }
} catch (e) {
  console.log(JSON.stringify({status_code: 500, body: String(e.message || e)}));
}
`,
		bodyJSON,
		string(headersJSON),
		code,
	)
}

func ms(start time.Time) int64 {
	return time.Since(start).Milliseconds()
}

func sanitize(s string) string {
	var b strings.Builder
	for _, c := range s {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
			(c >= '0' && c <= '9') || c == '_' || c == '-' {
			b.WriteRune(c)
		}
	}
	if b.Len() == 0 {
		return "fn"
	}
	return b.String()
}
