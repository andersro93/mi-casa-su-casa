package auth

import (
	"errors"

	"github.com/thecodearcher/limen"
)

// pluginName identifies our one custom Limen plugin. It must not collide with
// a name Limen or its official plugins register (limen/constants.go lists
// those).
const pluginName limen.PluginName = "mi-casa-core"

// corePlugin exists for one reason: *limen.LimenCore is not reachable from
// the *limen.Limen handle that limen.New returns, but every plugin is handed
// the core in Initialize. Registering a plugin that does nothing except keep
// the pointer is the supported way to reach core.CreateSession, core.DBAction
// and core.Cookies — the three things SignIn and the reset-mail lookup need
// and the public Limen surface does not expose.
//
// It registers no routes and no schemas.
type corePlugin struct {
	core *limen.LimenCore
}

func (p *corePlugin) Name() limen.PluginName { return pluginName }

func (p *corePlugin) Initialize(core *limen.LimenCore) error {
	if core == nil {
		return errors.New("auth: limen initialized the plugin with a nil core")
	}
	p.core = core
	return nil
}

func (p *corePlugin) PluginHTTPConfig() limen.PluginHTTPConfig {
	return limen.PluginHTTPConfig{}
}

func (p *corePlugin) RegisterRoutes(*limen.LimenHTTPCore, *limen.RouteBuilder) {}

var _ limen.Plugin = (*corePlugin)(nil)
