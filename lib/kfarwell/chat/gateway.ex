defmodule Kfarwell.Chat.Gateway do
  @moduledoc """
  Owns the Discord connection, and keeps its problems to itself.

  Supervised from here rather than the application tree so that a rejected
  token or an unreachable Discord costs the chat window, not the site. Retries
  every minute.
  """

  use GenServer

  require Logger

  @retry_after :timer.minutes(1)

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  # A lookup rather than a call: this process can sit in start_link/2 for
  # seconds, and a page load must not wait on it.
  @doc "Whether the bot is currently connected."
  @spec connected?() :: boolean()
  def connected?, do: Process.whereis(Nostrum.Shard.Supervisor) != nil

  @impl true
  def init(_opts) do
    Process.flag(:trap_exit, true)
    {:ok, %{supervisor: nil}, {:continue, :connect}}
  end

  @impl true
  def handle_continue(:connect, state), do: {:noreply, connect(state)}

  @impl true
  def handle_info(:retry, state), do: {:noreply, connect(state)}

  def handle_info({:EXIT, pid, reason}, %{supervisor: pid} = state) do
    Logger.warning("Discord bridge went down: #{inspect(reason)}. Retrying in a minute.")
    schedule_retry()
    {:noreply, %{state | supervisor: nil}}
  end

  # A failed start can still leave its exit signal behind.
  def handle_info(_message, state), do: {:noreply, state}

  defp connect(%{supervisor: nil} = state) do
    # Nostrum must be up before the consumer joins its group, and the consumer
    # follows it on restart.
    children = [Nostrum.Application, Kfarwell.Chat.Bot]

    case Supervisor.start_link(children, strategy: :rest_for_one) do
      {:ok, supervisor} ->
        Logger.info("Discord bridge connected")
        %{state | supervisor: supervisor}

      {:error, reason} ->
        Logger.warning("Discord bridge unavailable: #{inspect(reason)}. Retrying in a minute.")
        schedule_retry()
        state
    end
  end

  defp connect(state), do: state

  defp schedule_retry, do: Process.send_after(self(), :retry, @retry_after)
end
