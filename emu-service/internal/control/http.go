package control

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/oplog"
)

// dashboardPage is served from the binary so the dev tool needs no build step,
// no package manager, and nothing fetched at runtime.
//
//go:embed dashboard.html
var dashboardPage []byte

// About is what the dashboard reports about the emu it is driving.
type About struct {
	// Services are the emulators the config declared. Until P3–P6 land, none of
	// them binds a port, and the dashboard says so rather than implying otherwise.
	Services []string `json:"services"`
	// ConfigPath is the config this emu loaded, empty when it has none.
	ConfigPath string `json:"config_path"`
	// Child is the command this emu is supervising, empty for `emu dev`.
	Child string `json:"child"`
	// CanRun reports whether the page may start a process, which only `emu dev`
	// allows — see Runner.
	CanRun bool `json:"can_run"`
}

// A Dashboard serves the HTTP control plane and the page that drives it.
//
// Like the Unix socket, this exists for an emu running locally where there is no
// untrusted child, and it opens only from an argv flag. Unlike the socket it is
// reachable over the network, so Bind refuses anything but a loopback address.
type Dashboard struct {
	listener net.Listener
	server   *http.Server
	about    About
	runner   *Runner
}

// Bind opens the control plane on address, which must be loopback. A nil runner
// means this emu is already supervising a child and the page may not start one.
func Bind(address string, intercept *Interceptor, about About, runner *Runner) (*Dashboard, error) {
	if err := requireLoopback(address); err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return nil, fmt.Errorf("dev control bind: %w", err)
	}

	about.CanRun = runner != nil
	dashboard := &Dashboard{listener: listener, about: about, runner: runner}
	dashboard.server = &http.Server{Handler: dashboard.routes(intercept)}
	return dashboard, nil
}

// URL is where a browser should go.
func (d *Dashboard) URL() string { return "http://" + d.listener.Addr().String() }

// Serve answers requests until Close.
func (d *Dashboard) Serve() { _ = d.server.Serve(d.listener) }

// Close stops the control plane.
func (d *Dashboard) Close() error { return d.server.Close() }

func (d *Dashboard) routes(intercept *Interceptor) *http.ServeMux {
	routes := http.NewServeMux()

	routes.HandleFunc("GET /{$}", func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = writer.Write(dashboardPage)
	})

	routes.HandleFunc("GET /api/state", func(writer http.ResponseWriter, request *http.Request) {
		log := intercept.Log()
		reply(writer, http.StatusOK, state{
			About:   d.about,
			Rules:   intercept.Rules(),
			Entries: log.Since(cursor(request, "since")),
			Dropped: log.Dropped(),
			Child:   d.childStatus(cursor(request, "output")),
		})
	})

	routes.HandleFunc("POST /api/faults", func(writer http.ResponseWriter, request *http.Request) {
		var rule Rule
		if err := decode(request, &rule); err != nil {
			refuse(writer, http.StatusBadRequest, err)
			return
		}
		if err := intercept.AddRule(rule); err != nil {
			refuse(writer, http.StatusBadRequest, err)
			return
		}
		reply(writer, http.StatusOK, rules{Rules: intercept.Rules()})
	})

	routes.HandleFunc("DELETE /api/faults/{index}", func(writer http.ResponseWriter, request *http.Request) {
		index, err := strconv.Atoi(request.PathValue("index"))
		if err != nil {
			refuse(writer, http.StatusBadRequest, fmt.Errorf("index %q is not a number", request.PathValue("index")))
			return
		}
		if err := intercept.RemoveRule(index); err != nil {
			refuse(writer, http.StatusNotFound, err)
			return
		}
		reply(writer, http.StatusOK, rules{Rules: intercept.Rules()})
	})

	routes.HandleFunc("POST /api/faults/reset", func(writer http.ResponseWriter, _ *http.Request) {
		intercept.ResetRules()
		reply(writer, http.StatusOK, rules{Rules: intercept.Rules()})
	})

	routes.HandleFunc("POST /api/ops", func(writer http.ResponseWriter, request *http.Request) {
		var op Op
		if err := decode(request, &op); err != nil {
			refuse(writer, http.StatusBadRequest, err)
			return
		}
		if op.Emulator == "" || op.Kind == "" {
			refuse(writer, http.StatusBadRequest, errors.New("an operation needs an emulator and a kind"))
			return
		}
		reply(writer, http.StatusOK, describe(intercept.Fire(op)))
	})

	routes.HandleFunc("POST /api/child", func(writer http.ResponseWriter, request *http.Request) {
		if d.runner == nil {
			refuse(writer, http.StatusConflict, errors.New("this emu already supervises "+d.about.Child))
			return
		}
		var start struct {
			Command string `json:"command"`
		}
		if err := decode(request, &start); err != nil {
			refuse(writer, http.StatusBadRequest, err)
			return
		}
		if err := d.runner.Start(start.Command); err != nil {
			refuse(writer, http.StatusConflict, err)
			return
		}
		reply(writer, http.StatusOK, d.runner.Status(0))
	})

	routes.HandleFunc("DELETE /api/child", func(writer http.ResponseWriter, _ *http.Request) {
		if d.runner == nil {
			refuse(writer, http.StatusConflict, errors.New("this emu already supervises "+d.about.Child))
			return
		}
		if err := d.runner.Stop(); err != nil {
			refuse(writer, http.StatusConflict, err)
			return
		}
		reply(writer, http.StatusOK, d.runner.Status(0))
	})

	return routes
}

// childStatus is nil for an emu that is already supervising, so the page can
// hide the panel rather than offering something that would be refused.
func (d *Dashboard) childStatus(since int) *ChildStatus {
	if d.runner == nil {
		return nil
	}
	status := d.runner.Status(since)
	return &status
}

// cursor reads a poll position, treating anything unreadable as "start over".
func cursor(request *http.Request, name string) int {
	position, err := strconv.Atoi(request.URL.Query().Get(name))
	if err != nil {
		return 0
	}
	return position
}

// state is one poll's worth of everything the page shows.
type state struct {
	About   About         `json:"about"`
	Rules   []Rule        `json:"rules"`
	Entries []oplog.Entry `json:"oplog"`
	Dropped int           `json:"dropped"`
	Child   *ChildStatus  `json:"child,omitempty"`
}

type rules struct {
	Rules []Rule `json:"rules"`
}

// verdictView is a Verdict the page can read: an error interface does not
// survive JSON.
type verdictView struct {
	DelayMillis int    `json:"delay_ms"`
	DropConn    bool   `json:"drop_conn"`
	Error       string `json:"error,omitempty"`
	Fault       string `json:"fault,omitempty"`
}

func describe(verdict Verdict) verdictView {
	view := verdictView{
		DelayMillis: int(verdict.Delay.Milliseconds()),
		DropConn:    verdict.DropConn,
		Fault:       verdict.Fault,
	}
	if verdict.Err != nil {
		view.Error = verdict.Err.Error()
	}
	return view
}

// decode reads a JSON body, refusing fields the type does not have so that a
// misspelled rule field is a failed request rather than a rule that never fires.
func decode(request *http.Request, into any) error {
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(into)
}

func reply(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	// A failed write means the browser navigated away; there is nobody to tell.
	_ = json.NewEncoder(writer).Encode(payload)
}

func refuse(writer http.ResponseWriter, status int, err error) {
	reply(writer, status, map[string]string{"error": err.Error()})
}

// requireLoopback keeps the control plane on this machine. The plan wrote
// ":9100", which binds every interface — on a laptop on a shared network that
// hands anyone a fault injector and a live op log.
func requireLoopback(address string) error {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("dev control bind %q: want host:port, such as 127.0.0.1:9100", address)
	}
	if port == "" {
		return fmt.Errorf("dev control bind %q: no port", address)
	}
	if host == "localhost" {
		return nil
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return nil
	}
	return fmt.Errorf("dev control bind %q: only loopback, such as 127.0.0.1:%s — the control plane must not leave this machine", address, port)
}
