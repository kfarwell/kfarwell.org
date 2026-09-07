defmodule Kfarwell.Application do
  @moduledoc false

  use Application

  require Logger

  @impl true
  def start(_type, _args) do
    children =
      [
        KfarwellWeb.Telemetry,
        {DNSCluster, query: Application.get_env(:kfarwell, :dns_cluster_query) || :ignore},
        {Phoenix.PubSub, name: Kfarwell.PubSub},
        Kfarwell.Presence,
        Kfarwell.AppleMusic
      ] ++ discord_children() ++ [KfarwellWeb.Endpoint]

    opts = [strategy: :one_for_one, name: Kfarwell.Supervisor]
    Supervisor.start_link(children, opts)
  end

  defp discord_children do
    if Application.get_env(:nostrum, :token) do
      [Kfarwell.Chat.Threads, Kfarwell.Chat.Gateway]
    else
      Logger.info("DISCORD_BOT_TOKEN not set, chat disabled")
      []
    end
  end

  @impl true
  def config_change(changed, _new, removed) do
    KfarwellWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
