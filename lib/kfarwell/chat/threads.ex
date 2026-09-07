defmodule Kfarwell.Chat.Threads do
  @moduledoc """
  Remembers which forum thread belongs to which visitor.

  Threads are named `<nickname>_<id>`, so the map is cached in ETS but rebuilt
  from Discord on boot.
  """

  use GenServer

  require Logger

  @table :chat_threads
  @default_nickname "visitor"

  # Ids are 16 characters, so a name splits at a known point. Nicknames are
  # free-form and old ids can contain an underscore, so splitting on one won't do.
  @id_length 16
  # Discord caps thread names at 100 characters.
  @max_nickname 60

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @doc "Builds the Discord thread name for a visitor."
  @spec thread_name(String.t(), String.t() | nil) :: String.t()
  def thread_name(visitor_id, nickname \\ nil) do
    nickname(nickname) <> "_" <> visitor_id
  end

  @doc "Trims a nickname down to something a thread name can hold."
  @spec nickname(String.t() | nil) :: String.t()
  def nickname(nickname) when is_binary(nickname) do
    cleaned =
      nickname
      |> String.replace(~r/\s+/u, " ")
      |> String.trim()
      |> String.slice(0, @max_nickname)

    if cleaned == "", do: @default_nickname, else: cleaned
  end

  def nickname(_nickname), do: @default_nickname

  @doc "Extracts the visitor id from a thread name, if it is one of ours."
  @spec visitor_id_from_name(String.t() | nil) :: {:ok, String.t()} | :error
  def visitor_id_from_name(name) when is_binary(name) do
    id = String.slice(name, -@id_length, @id_length)

    if String.length(name) > @id_length and
         String.at(name, -(@id_length + 1)) == "_" and
         id =~ ~r/^[A-Za-z0-9_-]{#{@id_length}}$/ do
      {:ok, id}
    else
      :error
    end
  end

  def visitor_id_from_name(_name), do: :error

  @doc "Asks Discord whether this visitor already has a thread."
  @spec find_remote(String.t()) :: {:ok, Nostrum.Struct.Channel.id()} | :error
  def find_remote(visitor_id) do
    suffix = "_" <> visitor_id

    case Enum.find(remote_threads(), &String.ends_with?(&1.name, suffix)) do
      nil ->
        :error

      thread ->
        put(visitor_id, thread.id, thread.name)
        {:ok, thread.id}
    end
  end

  @spec lookup(String.t()) :: {:ok, Nostrum.Struct.Channel.id()} | :error
  def lookup(visitor_id) do
    case :ets.lookup(@table, {:visitor, visitor_id}) do
      [{_key, thread_id}] -> {:ok, thread_id}
      [] -> :error
    end
  end

  @spec visitor_for(Nostrum.Struct.Channel.id()) :: {:ok, String.t()} | :error
  def visitor_for(thread_id) do
    case :ets.lookup(@table, {:thread, thread_id}) do
      [{_key, visitor_id}] -> {:ok, visitor_id}
      [] -> :error
    end
  end

  @spec put(String.t(), Nostrum.Struct.Channel.id(), String.t() | nil) :: :ok
  def put(visitor_id, thread_id, name \\ nil),
    do: GenServer.call(__MODULE__, {:put, visitor_id, thread_id, name})

  @doc "The name we last saw on a visitor's thread, if we know it."
  @spec name(String.t()) :: String.t() | nil
  def name(visitor_id) do
    case :ets.lookup(@table, {:name, visitor_id}) do
      [{_key, name}] -> name
      [] -> nil
    end
  end

  @doc "Forgets a visitor's thread, once it turns out to be gone."
  @spec forget(String.t()) :: :ok
  def forget(visitor_id), do: GenServer.call(__MODULE__, {:forget, visitor_id})

  @doc "Rebuilds the cache from Discord. Called once the gateway is ready."
  @spec sync() :: :ok
  def sync, do: GenServer.cast(__MODULE__, :sync)

  @impl true
  def init(_opts) do
    :ets.new(@table, [:named_table, :set, :protected, read_concurrency: true])
    Kfarwell.Chat.Webhook.init_table()
    {:ok, %{}}
  end

  @impl true
  def handle_call({:put, visitor_id, thread_id, name}, _from, state) do
    insert(visitor_id, thread_id, name)
    {:reply, :ok, state}
  end

  @impl true
  def handle_call({:forget, visitor_id}, _from, state) do
    case lookup(visitor_id) do
      {:ok, thread_id} -> :ets.delete(@table, {:thread, thread_id})
      :error -> :ok
    end

    :ets.delete(@table, {:visitor, visitor_id})
    :ets.delete(@table, {:name, visitor_id})
    {:reply, :ok, state}
  end

  @impl true
  def handle_cast(:sync, state) do
    count =
      Enum.count(discover(), fn {visitor_id, thread_id, name} ->
        insert(visitor_id, thread_id, name)
      end)

    Logger.info("Synced #{count} visitor chat threads from Discord")
    {:noreply, state}
  end

  defp insert(visitor_id, thread_id, name) do
    :ets.insert(@table, {{:visitor, visitor_id}, thread_id})
    :ets.insert(@table, {{:thread, thread_id}, visitor_id})
    if name, do: :ets.insert(@table, {{:name, visitor_id}, name})
    true
  end

  defp remote_threads do
    forum_id = Kfarwell.Chat.forum_channel_id()
    guild_id = Kfarwell.Chat.guild_id()

    active =
      case guild_id && Nostrum.Api.Thread.list(guild_id) do
        {:ok, %{threads: threads}} -> threads
        _ -> []
      end

    archived =
      case forum_id && Nostrum.Api.Thread.public_archived_threads(forum_id, limit: 100) do
        {:ok, %{threads: threads}} -> threads
        _ -> []
      end

    Enum.filter(active ++ archived, &(&1.parent_id == forum_id))
  end

  defp discover do
    remote_threads()
    |> Enum.flat_map(fn thread ->
      case visitor_id_from_name(thread.name) do
        {:ok, visitor_id} -> [{visitor_id, thread.id, thread.name}]
        :error -> []
      end
    end)
  end
end
